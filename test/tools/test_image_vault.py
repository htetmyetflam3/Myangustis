"""Personal SVG vault: anonymous transparent rasters and recovery."""
import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

from PIL import Image
from resvg_py import svg_to_bytes

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('image_vault', ROOT / 'tools-box/python/image_vault.py')
vault = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vault)


def pixels(data):
    with Image.open(io.BytesIO(data)) as im:
        im.load()
        return im.convert('RGBA').tobytes()


class ImageVaultTests(unittest.TestCase):
    def test_sig_artwork_uses_one_anonymous_two_raster_group_per_secret(self):
        original = (ROOT / 'sig.svg').read_bytes()
        initial_hash = hashlib.sha256(original).hexdigest()
        items = {'SerpApi': 'fake-sensitive-secret-314159', 'SSH personal': 'first line\nsecond line\n'}
        before = vault._svg_root(original)
        result = vault.create_raster_svg(original, items)
        after = vault._svg_root(result)
        self.assertEqual(vault.raster_items(result), items)
        self.assertEqual(hashlib.sha256((ROOT / 'sig.svg').read_bytes()).hexdigest(), initial_hash)
        # New groups have no id or label attributes, and no visible elements.
        self.assertEqual(len(after), len(before) + len(items))
        added = list(after)[-len(items):]
        prefix = 'data:image/png;base64,'
        for group, (name, value) in zip(added, items.items()):
            self.assertEqual(group.tag, '{http://www.w3.org/2000/svg}g')
            self.assertEqual(group.attrib, {})
            self.assertEqual(len(group), 2)
            for child in group:
                self.assertEqual(child.tag, '{http://www.w3.org/2000/svg}image')
                self.assertNotIn('id', child.attrib)
                self.assertTrue(child.attrib['href'].startswith(prefix))
                raster = base64.b64decode(child.attrib['href'][len(prefix):])
                with Image.open(io.BytesIO(raster)) as im:
                    self.assertEqual(im.mode, 'RGBA')
                    self.assertEqual(im.getchannel('A').getextrema(), (0, 0))
            lower = base64.b64decode(group[0].attrib['href'][len(prefix):])
            upper = base64.b64decode(group[1].attrib['href'][len(prefix):])
            with Image.open(io.BytesIO(lower)) as im:
                # No encryption: anyone can read the Comment once decoded.
                self.assertEqual(json.loads(im.info['Comment']), {'name': name, 'value': value})
            with Image.open(io.BytesIO(upper)) as im:
                self.assertNotIn('Comment', im.info)
        self.assertEqual(pixels(svg_to_bytes(svg_string=original.decode())),
                         pixels(svg_to_bytes(svg_string=result.decode())))
        self.assertNotIn(b'fake-sensitive-secret-314159', result)  # encoded, not encrypted

    def test_many_secrets_unicode_and_multiline(self):
        base = b'<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"></svg>'
        items = {f'အကောင့် {i}': f'password\n{i}\n' for i in range(100)}
        result = vault.create_raster_svg(base, items)
        self.assertEqual(vault.raster_items(result), items)

    def test_copy_retains_entries_without_any_password(self):
        base = b'<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"></svg>'
        svg = vault.create_raster_svg(base, {'account': 'value'})
        with tempfile.TemporaryDirectory() as temp:
            first, second = Path(temp) / 'a.svg', Path(temp) / 'b.svg'
            first.write_bytes(svg)
            shutil.copyfile(first, second)
            self.assertEqual(vault.raster_items(second.read_bytes()), {'account': 'value'})

    def test_removing_added_groups_may_destroy_data(self):
        base = b'<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"></svg>'
        svg = vault.create_raster_svg(base, {'x': 'value'})
        root = vault._svg_root(svg)
        root.remove(root[-1])
        self.assertEqual(vault.raster_items(ET.tostring(root)), {})

    def test_add_creates_separate_copy_keeps_original_and_prevents_duplicates(self):
        base = b'<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"></svg>'
        first = vault.create_raster_svg(base, {'one': 'first'})
        second = vault.create_raster_svg(first, {'two': 'second'}, allow_existing=True)
        self.assertEqual(vault.raster_items(first), {'one': 'first'})
        self.assertEqual(vault.raster_items(second), {'one': 'first', 'two': 'second'})
        with self.assertRaisesRegex(vault.VaultError, 'already exist'):
            vault.create_raster_svg(first, {'one': 'replacement'}, allow_existing=True)
        with self.assertRaisesRegex(vault.VaultError, 'use the add'):
            vault.create_raster_svg(first, {'two': 'second'})
        with self.assertRaisesRegex(vault.VaultError, 'use the create'):
            vault.create_raster_svg(base, {'two': 'second'}, allow_existing=True)

    def test_interactive_cli_create_add_open_no_passphrase(self):
        with tempfile.TemporaryDirectory() as temp:
            first, second, output = (Path(temp) / x for x in ('first.svg', 'second.svg', 'out.json'))
            with patch('sys.stdin.isatty', return_value=True), \
                 patch('builtins.input', side_effect=['first', '']), \
                 patch('getpass.getpass', return_value='first-value') as prompt:
                self.assertEqual(vault.main(['create', '--svg', str(first)]), 0)
            self.assertEqual(prompt.call_count, 1)  # value entry, no vault passphrase
            with patch('sys.stdin.isatty', return_value=True), \
                 patch('builtins.input', side_effect=['second', '']), \
                 patch('getpass.getpass', return_value='second-value') as prompt:
                self.assertEqual(vault.main(['add', str(first), '--svg', str(second)]), 0)
            self.assertEqual(prompt.call_count, 1)
            with patch('sys.stdin.isatty', return_value=False), \
                 patch('getpass.getpass', side_effect=AssertionError('unexpected password prompt')):
                self.assertEqual(vault.main(['open', str(second), '--output', str(output)]), 0)
            self.assertEqual(json.loads(output.read_text()), {'first': 'first-value', 'second': 'second-value'})
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            self.assertEqual(vault.raster_items(first.read_bytes()), {'first': 'first-value'})

    def test_refuses_duplicate_names_during_interactive_add(self):
        with patch('builtins.input', side_effect=['existing', 'new', '']), \
             patch('getpass.getpass', return_value='new-value'):
            self.assertEqual(vault.collect_items({'existing'}), {'new': 'new-value'})

    def test_no_overwrite_and_owner_only_permissions(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'private.svg'
            vault.save_new(path, b'test')
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaisesRegex(vault.VaultError, 'overwrite'):
                vault.save_new(path, b'new')
            self.assertEqual(path.read_bytes(), b'test')

    def test_interactive_values_and_private_key_file(self):
        with tempfile.TemporaryDirectory() as temp:
            key = Path(temp) / 'key'
            key.write_text('first line\nsecond line\n')
            with patch('builtins.input', side_effect=['server', 'literal', '']), \
                 patch('getpass.getpass', side_effect=['@' + str(key), '@@value']):
                self.assertEqual(vault.collect_items(), {'server': 'first line\nsecond line\n', 'literal': '@value'})

    def test_legacy_encrypted_vault_still_requires_existing_password(self):
        source = b'<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"></svg>'
        legacy = vault.add_svg_vault(source, ['old'], vault.encrypt_items({'old': 'old-value'}, 'old-passphrase'))
        self.assertEqual(vault.raster_items(legacy), {})
        with tempfile.TemporaryDirectory() as temp:
            image, output = Path(temp) / 'old.svg', Path(temp) / 'out.json'
            image.write_bytes(legacy)
            with patch('sys.stdin.isatty', return_value=True), patch('getpass.getpass', return_value='old-passphrase'):
                self.assertEqual(vault.main(['open', str(image), '--output', str(output)]), 0)
            self.assertEqual(json.loads(output.read_text()), {'old': 'old-value'})

    def test_legacy_png_and_jpeg_still_recover_svg(self):
        source = b'<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"></svg>'
        legacy = vault.add_svg_vault(source, ['old'], vault.encrypt_items({'old': 'old-value'}, 'old-passphrase'))
        import zlib
        compressed = zlib.compress(legacy)
        for fmt, embed in [('PNG', vault.png_embed), ('JPEG', vault.jpeg_embed)]:
            image = Image.new('RGB', (4, 3), (28, 73, 199))
            out = io.BytesIO()
            image.save(out, format=fmt)
            self.assertEqual(vault.recover_svg(embed(out.getvalue(), compressed)), legacy)

    def test_cli_refuses_noninteractive_secret_entry(self):
        with tempfile.TemporaryDirectory() as temp, patch('sys.stdin.isatty', return_value=False):
            output = Path(temp) / 'vault.svg'
            self.assertEqual(vault.main(['create', '--svg', str(output)]), 1)
            self.assertFalse(output.exists())

    def test_refuses_getpass_echo_fallback(self):
        import getpass
        import warnings
        def insecure(prompt):
            warnings.warn('echo enabled', getpass.GetPassWarning)
            return 'not secret'
        with patch('getpass.getpass', side_effect=insecure):
            with self.assertRaisesRegex(vault.VaultError, 'echo'):
                vault.secret_prompt('Secret: ')

    def test_invalid_or_empty_input(self):
        with self.assertRaisesRegex(vault.VaultError, 'At least one'):
            vault.create_raster_svg(b'<svg xmlns="http://www.w3.org/2000/svg"></svg>', {})
        with self.assertRaises(vault.VaultError):
            vault.create_raster_svg(b'not svg', {'x': 'value'})


if __name__ == '__main__':
    unittest.main()
