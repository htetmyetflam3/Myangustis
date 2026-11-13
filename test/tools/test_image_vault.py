"""Personal image vault: encrypted secrets, invisible metadata and recovery."""
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('image_vault', ROOT / 'tools-box/python/image_vault.py')
vault = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vault)


def make_image(fmt, *, noise=False):
    image = Image.frombytes('RGB', (600, 600), os.urandom(600 * 600 * 3)) if noise else Image.new('RGB', (4, 3), (28, 73, 199))
    out = io.BytesIO()
    image.save(out, format=fmt)
    return out.getvalue()


def pixels(data):
    with Image.open(io.BytesIO(data)) as im:
        im.load()
        return im.convert('RGBA').tobytes()


class ImageVaultTests(unittest.TestCase):
    def test_png_svg_jpeg_recover_secrets_and_keep_png_pixels(self):
        original = make_image('PNG')
        items = {'SerpApi': 'sensitive-secret-314159', 'SSH personal': 'first line\nsecond line\n'}
        result = vault.create_outputs(original, items, 'correct horse battery staple', svg=True, png=True, jpg=True)
        self.assertEqual(pixels(original), pixels(result['png']))
        for data in result.values():
            with self.subTest(length=len(data)):
                svg = vault.recover_svg(data)
                self.assertEqual(svg, result['svg'])
                self.assertNotIn(b'sensitive-secret-314159', data)
                self.assertEqual(vault.decrypt_items(vault.svg_envelope(svg), 'correct horse battery staple'), items)
                with self.assertRaisesRegex(vault.VaultError, 'Wrong passphrase'):
                    vault.decrypt_items(vault.svg_envelope(svg), 'not-the-password')
        root = ET.fromstring(result['svg'])
        self.assertEqual([g.attrib['data-label'] for g in root.iter() if 'data-label' in g.attrib], list(items))
        self.assertIn(b'SerpApi', result['svg'])  # labels are intentionally visible

    def test_jpeg_input_bytes_and_pixels_preserved_with_large_multisegment_vault(self):
        original = make_image('JPEG', noise=True)
        result = vault.create_outputs(original, {'key': 'my-password'}, 'correct horse battery staple', svg=True, jpg=True)
        self.assertEqual(pixels(original), pixels(result['jpg']))
        self.assertEqual(vault.recover_svg(result['jpg']), result['svg'])
        self.assertGreater(result['jpg'].count(vault.JPEG_MAGIC), 1)
        self.assertTrue(result['jpg'].endswith(original[2:]))

    def test_svg_input_preserved_and_values_stay_encrypted(self):
        source = b'<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"><rect width="2" height="3" fill="red"/></svg>'
        result = vault.create_outputs(source, {'Platform': 'long-password'}, 'correct horse battery staple', svg=True, png=True)
        self.assertIn(b'<rect width="2" height="3" fill="red"/>', result['svg'])
        self.assertNotIn(b'long-password', result['svg'])
        self.assertEqual(vault.recover_svg(result['png']), result['svg'])

    def test_stripped_and_corrupted_metadata_cannot_recover(self):
        result = vault.create_outputs(make_image('PNG'), {'x': 'secret'}, 'correct horse battery staple', png=True)
        with Image.open(io.BytesIO(result['png'])) as im:
            out = io.BytesIO()
            im.save(out, format='PNG')  # ordinary re-export drops metadata
        with self.assertRaisesRegex(vault.VaultError, 'metadata found'):
            vault.recover_svg(out.getvalue())
        corrupt = bytearray(result['png'])
        i = corrupt.index(vault.PNG_KEY)
        corrupt[i + len(vault.PNG_KEY) + 4] ^= 1
        with self.assertRaises(vault.VaultError):
            vault.recover_svg(bytes(corrupt))

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

    def test_interactive_cli_create_then_export_plaintext(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, encoded, output = root / 'image.png', root / 'vault.png', root / 'secrets.json'
            source.write_bytes(make_image('PNG'))
            with patch('sys.stdin.isatty', return_value=True), \
                 patch('builtins.input', side_effect=['my key', '']), \
                 patch('getpass.getpass', side_effect=['my-secret-value', 'super secret passphrase', 'super secret passphrase']):
                self.assertEqual(vault.main(['create', str(source), '--png', str(encoded)]), 0)
            self.assertNotIn(b'my-secret-value', encoded.read_bytes())
            with patch('sys.stdin.isatty', return_value=True), \
                 patch('getpass.getpass', return_value='super secret passphrase'):
                self.assertEqual(vault.main(['open', str(encoded), '--output', str(output)]), 0)
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            self.assertEqual(__import__('json').loads(output.read_text()), {'my key': 'my-secret-value'})

    def test_wrong_passphrase_does_not_write_plaintext(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            output = root / 'secrets.json'
            image = root / 'vault.png'
            image.write_bytes(vault.create_outputs(make_image('PNG'), {'x': 'secret-value'},
                                                    'correct passphrase', png=True)['png'])
            with patch('sys.stdin.isatty', return_value=True), \
                 patch('getpass.getpass', return_value='wrong passphrase'):
                self.assertEqual(vault.main(['open', str(image), '--output', str(output)]), 1)
            self.assertFalse(output.exists())

    def test_cli_refuses_noninteractive_secret_entry(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'image.png'
            source.write_bytes(make_image('PNG'))
            with patch('sys.stdin.isatty', return_value=False):
                self.assertEqual(vault.main(['create', str(source), '--png', str(root / 'vault.png')]), 1)
            self.assertFalse((root / 'vault.png').exists())

    def test_refuses_getpass_echo_fallback(self):
        import getpass
        import warnings
        def insecure(prompt):
            warnings.warn('echo enabled', getpass.GetPassWarning)
            return 'not secret'
        with patch('getpass.getpass', side_effect=insecure):
            with self.assertRaisesRegex(vault.VaultError, 'echo'):
                vault.secret_prompt('Secret: ')

    def test_create_rejects_vault_input_and_empty_secrets(self):
        original = make_image('PNG')
        result = vault.create_outputs(original, {'x': 'secret'}, 'correct horse battery staple', png=True)
        with self.assertRaisesRegex(vault.VaultError, 'already contains'):
            vault.create_outputs(result['png'], {'x': 'secret'}, 'correct horse battery staple', png=True)
        with self.assertRaisesRegex(vault.VaultError, 'At least one'):
            vault.create_outputs(original, {}, 'correct horse battery staple', svg=True)


if __name__ == '__main__':
    unittest.main()
