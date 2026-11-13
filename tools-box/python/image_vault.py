# /// script
# requires-python = ">=3.10"
# dependencies = ["cryptography>=42", "Pillow>=10", "resvg-py>=0.5"]
# ///
"""Encrypt personal secrets into an SVG and/or recoverable PNG/JPEG metadata.

These files are NOT a conventional password manager. Labels in the SVG are
visible; values are AES-GCM encrypted with a passphrase-derived key. Image
editing, messaging and hosting services may strip metadata. Keep independent
backups and do not commit vault images to Git. See IMAGE-VAULT.md.
"""
from __future__ import annotations

import argparse
import base64
import binascii
import getpass
import io
import json
import os
from pathlib import Path
import re
import struct
import sys
import uuid
import warnings
import xml.etree.ElementTree as ET
from xml.sax.saxutils import quoteattr
import zlib

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
JPEG_SIGNATURE = b'\xff\xd8'
PNG_KEY = b'MyangustisImageVault'
JPEG_MAGIC = b'MyangustisVault1\0'
AAD = b'myangustis-image-vault-v1'
VAULT_ATTRIBUTE = 'data-myangustis-vault'
DEFAULT_IMAGE = Path(__file__).resolve().parents[2] / 'sig.svg'
MAX_IMAGE = 24 * 1024 * 1024
MAX_ARCHIVE = 80 * 1024 * 1024
MAX_SVG = 40 * 1024 * 1024
MAX_SECRETS = 1024 * 1024
JPEG_PIECE = 60000


class VaultError(Exception):
    pass


def _b64(data):
    return base64.b64encode(data).decode('ascii')


def _unb64(value):
    try:
        return base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error, TypeError) as exc:
        raise VaultError('Invalid vault encoding.') from exc


def _derive(passphrase, salt):
    return Scrypt(salt=salt, length=32, n=32768, r=8, p=1).derive(passphrase.encode('utf-8'))


def encrypt_items(items, passphrase):
    if not isinstance(items, dict) or not items:
        raise VaultError('At least one named secret is required.')
    if any(not isinstance(k, str) or not k.strip() or not isinstance(v, str) or not v
           for k, v in items.items()):
        raise VaultError('Secret names and values must be nonempty strings.')
    raw = json.dumps(items, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    if len(raw) > MAX_SECRETS:
        raise VaultError('The combined secrets are too large (maximum 1 MiB).')
    salt, nonce = os.urandom(16), os.urandom(12)
    ciphertext = AESGCM(_derive(passphrase, salt)).encrypt(nonce, raw, AAD)
    return json.dumps({'version': 1, 'salt': _b64(salt), 'nonce': _b64(nonce),
                       'ciphertext': _b64(ciphertext)}, separators=(',', ':'))


def decrypt_items(envelope, passphrase):
    try:
        data = json.loads(envelope)
        if not isinstance(data, dict) or data.get('version') != 1:
            raise VaultError('Unsupported vault format.')
        salt, nonce, ciphertext = (_unb64(data[k]) for k in ('salt', 'nonce', 'ciphertext'))
        if len(salt) != 16 or len(nonce) != 12 or len(ciphertext) > MAX_SECRETS + 16:
            raise VaultError('Invalid vault data.')
        raw = AESGCM(_derive(passphrase, salt)).decrypt(nonce, ciphertext, AAD)
        result = json.loads(raw.decode('utf-8'))
        if not isinstance(result, dict) or any(not isinstance(k, str) or not isinstance(v, str)
                                               for k, v in result.items()):
            raise VaultError('Invalid secret collection.')
        return result
    except InvalidTag as exc:
        raise VaultError('Wrong passphrase or damaged vault.') from exc
    except (KeyError, ValueError, TypeError, UnicodeError, json.JSONDecodeError) as exc:
        raise VaultError('Invalid vault data.') from exc


def _svg_root(svg):
    if len(svg) > MAX_SVG:
        raise VaultError('SVG is too large (maximum 40 MiB).')
    if re.search(br'<!DOCTYPE|<!ENTITY', svg, re.I):
        raise VaultError('SVG files containing a DTD or entity declarations are not supported.')
    try:
        root = ET.fromstring(svg)
    except ET.ParseError as exc:
        raise VaultError('Invalid SVG.') from exc
    if root.tag != '{http://www.w3.org/2000/svg}svg':
        raise VaultError('Expected an SVG with the standard SVG namespace.')
    return root


def svg_envelope(svg):
    root = _svg_root(svg)
    matches = [node for node in root.iter() if node.attrib.get(VAULT_ATTRIBUTE) == '1']
    if len(matches) != 1 or not matches[0].text:
        raise VaultError('No unique image vault was found in the SVG.')
    try:
        return _unb64(matches[0].text.strip()).decode('utf-8')
    except UnicodeError as exc:
        raise VaultError('Invalid SVG vault data.') from exc


def add_svg_vault(svg, names, envelope):
    root = _svg_root(svg)
    if any(n.attrib.get(VAULT_ATTRIBUTE) == '1' for n in root.iter()):
        raise VaultError('This SVG already contains a vault; use a clean original.')
    opening = re.search(br'<(?P<prefix>[A-Za-z_][\w.-]*:)?svg(?:\s|>)', svg)
    endings = list(re.finditer(br'</(?P<prefix>[A-Za-z_][\w.-]*:)?svg\s*>', svg))
    if not opening or not endings:
        raise VaultError('The SVG must have an explicit closing svg tag.')
    prefix = opening.group('prefix') or b''
    ending = next((m for m in reversed(endings) if (m.group('prefix') or b'') == prefix), None)
    if ending is None:
        raise VaultError('Could not locate the closing SVG tag.')
    p = prefix.decode('ascii')
    unique = uuid.uuid4().hex[:12]
    labels = []
    for index, name in enumerate(names):
        slug = re.sub(r'[^A-Za-z0-9_.-]+', '-', name).strip('-')[:40] or 'item'
        labels.append(f'<{p}g id="vault-{unique}-{index}-{slug}" '
                      f'data-label={quoteattr(name)}/>')
    meta = (f'\n<{p}metadata {VAULT_ATTRIBUTE}="1">'
            f'{_b64(envelope.encode("utf-8"))}</{p}metadata>\n'
            + '\n'.join(labels) + '\n').encode('utf-8')
    result = svg[:ending.start()] + meta + svg[ending.start():]
    if len(result) > MAX_SVG:
        raise VaultError('Resulting SVG is too large (maximum 40 MiB).')
    if svg_envelope(result) != envelope:
        raise VaultError('Could not safely insert the vault into this SVG.')
    return result


def image_as_svg(image):
    from PIL import Image
    try:
        with Image.open(io.BytesIO(image)) as im:
            width, height = im.size
            kind = im.format
            if width <= 0 or height <= 0 or width * height > 100_000_000:
                raise VaultError('Image dimensions exceed the safety limit.')
            if kind not in ('PNG', 'JPEG'):
                raise VaultError('Input image must be SVG, PNG or JPEG.')
    except (OSError, ValueError) as exc:
        raise VaultError('Invalid image.') from exc
    mime = 'image/png' if kind == 'PNG' else 'image/jpeg'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
            f'viewBox="0 0 {width} {height}"><image width="{width}" height="{height}" '
            f'href="data:{mime};base64,{_b64(image)}"/></svg>').encode('utf-8')


def _png_chunks(data):
    if not data.startswith(PNG_SIGNATURE):
        raise VaultError('Not a PNG image.')
    pos = len(PNG_SIGNATURE)
    while pos + 12 <= len(data):
        length = struct.unpack('>I', data[pos:pos + 4])[0]
        end = pos + 12 + length
        if end > len(data):
            raise VaultError('Truncated PNG.')
        kind = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        crc = struct.unpack('>I', data[pos + 8 + length:end])[0]
        if zlib.crc32(kind + body) & 0xffffffff != crc:
            raise VaultError('PNG chunk checksum mismatch.')
        yield kind, body, pos, end
        pos = end
        if kind == b'IEND':
            if pos != len(data):
                raise VaultError('Unexpected data after PNG end.')
            return
    raise VaultError('PNG has no complete end marker.')


def _png_payload(data):
    found = []
    for kind, body, _, _ in _png_chunks(data):
        if kind == b'tEXt' and body.startswith(PNG_KEY + b'\0'):
            found.append(_unb64(body[len(PNG_KEY) + 1:]))
    if len(found) > 1:
        raise VaultError('More than one image vault was found.')
    return found[0] if found else None


def png_embed(data, compressed_svg):
    if _png_payload(data) is not None:
        raise VaultError('Input PNG already contains an image vault.')
    ending = next(start for kind, _, start, _ in _png_chunks(data) if kind == b'IEND')
    body = PNG_KEY + b'\0' + base64.b64encode(compressed_svg)
    kind = b'tEXt'
    chunk = struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body) & 0xffffffff)
    return data[:ending] + chunk + data[ending:]


def _jpeg_payload(data):
    if not data.startswith(JPEG_SIGNATURE):
        raise VaultError('Not a JPEG image.')
    pos, parts, expected = 2, {}, None
    while pos < len(data):
        if data[pos] != 0xff:
            raise VaultError('Invalid JPEG marker.')
        while pos < len(data) and data[pos] == 0xff:
            pos += 1
        if pos >= len(data):
            raise VaultError('Truncated JPEG.')
        marker = data[pos]
        pos += 1
        if marker in (0xd9, 0xda):  # end or start of compressed scan
            break
        if marker == 0x01 or 0xd0 <= marker <= 0xd7:
            continue
        if pos + 2 > len(data):
            raise VaultError('Truncated JPEG segment.')
        length = struct.unpack('>H', data[pos:pos + 2])[0]
        if length < 2 or pos + length > len(data):
            raise VaultError('Invalid JPEG segment length.')
        body = data[pos + 2:pos + length]
        if marker == 0xef and body.startswith(JPEG_MAGIC):
            if len(body) < len(JPEG_MAGIC) + 4:
                raise VaultError('Invalid vault segment.')
            index, count = struct.unpack('>HH', body[len(JPEG_MAGIC):len(JPEG_MAGIC) + 4])
            if not count or index >= count or (expected is not None and count != expected) or index in parts:
                raise VaultError('Invalid or duplicate vault segments.')
            expected = count
            parts[index] = body[len(JPEG_MAGIC) + 4:]
        pos += length
    if not parts:
        return None
    if len(parts) != expected:
        raise VaultError('JPEG vault segments are missing.')
    return b''.join(parts[i] for i in range(expected))


def jpeg_embed(data, compressed_svg):
    if _jpeg_payload(data) is not None:
        raise VaultError('Input JPEG already contains an image vault.')
    count = max(1, (len(compressed_svg) + JPEG_PIECE - 1) // JPEG_PIECE)
    if count > 65535:
        raise VaultError('Vault image is too large for JPEG metadata.')
    segments = []
    for i in range(count):
        body = JPEG_MAGIC + struct.pack('>HH', i, count) + compressed_svg[i * JPEG_PIECE:(i + 1) * JPEG_PIECE]
        segments.append(b'\xff\xef' + struct.pack('>H', len(body) + 2) + body)
    return data[:2] + b''.join(segments) + data[2:]


def recover_svg(data):
    if len(data) > MAX_ARCHIVE:
        raise VaultError('Vault image is too large (maximum 80 MiB).')
    if data.startswith(PNG_SIGNATURE):
        payload = _png_payload(data)
    elif data.startswith(JPEG_SIGNATURE):
        payload = _jpeg_payload(data)
    else:
        svg_envelope(data)
        return data
    if payload is None:
        raise VaultError('No image vault metadata found. It may have been stripped.')
    try:
        decompressor = zlib.decompressobj()
        svg = decompressor.decompress(payload, MAX_SVG + 1)
        if len(svg) > MAX_SVG or decompressor.unconsumed_tail or not decompressor.eof or decompressor.unused_data:
            raise VaultError('Invalid or oversized embedded SVG.')
    except zlib.error as exc:
        raise VaultError('Damaged image vault metadata.') from exc
    svg_envelope(svg)
    return svg


def rasterize(svg, fmt):
    try:
        from resvg_py import svg_to_bytes
        from PIL import Image
        # Only use SVGs you trust: rendering may access external references.
        png = svg_to_bytes(svg_string=svg.decode('utf-8'))
    except Exception as exc:
        raise VaultError('Could not render SVG; check the SVG and resvg-py installation.') from exc
    if fmt == 'png':
        return png
    with Image.open(io.BytesIO(png)) as im:
        im.load()
        rgba = im.convert('RGBA')
        background = Image.new('RGB', rgba.size, 'white')
        background.paste(rgba, mask=rgba.getchannel('A'))
        out = io.BytesIO()
        background.save(out, format='JPEG', quality=95)
        return out.getvalue()


def create_outputs(source, items, passphrase, *, svg=False, png=False, jpg=False):
    if len(source) > MAX_IMAGE:
        raise VaultError('Input image is too large (maximum 24 MiB).')
    if source.startswith(PNG_SIGNATURE):
        if _png_payload(source) is not None:
            raise VaultError('Input PNG already contains a vault.')
        base_svg = image_as_svg(source)
    elif source.startswith(JPEG_SIGNATURE):
        if _jpeg_payload(source) is not None:
            raise VaultError('Input JPEG already contains a vault.')
        base_svg = image_as_svg(source)
    else:
        base_svg = source
    enveloped = add_svg_vault(base_svg, list(items), encrypt_items(items, passphrase))
    compressed = zlib.compress(enveloped, level=9)
    result = {}
    if svg:
        result['svg'] = enveloped
    if png:
        original = source if source.startswith(PNG_SIGNATURE) else rasterize(enveloped, 'png')
        result['png'] = png_embed(original, compressed)
    if jpg:
        original = source if source.startswith(JPEG_SIGNATURE) else rasterize(enveloped, 'jpg')
        result['jpg'] = jpeg_embed(original, compressed)
    return result


def save_new(path, data):
    path = Path(path)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as exc:
        raise VaultError(f'Refusing to overwrite: {path}') from exc
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def secret_prompt(message):
    """Never fall back to an echoing input stream for a secret."""
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        try:
            return getpass.getpass(message)
        except getpass.GetPassWarning as exc:
            raise VaultError('Cannot disable terminal echo; refusing to read a secret.') from exc


def collect_items():
    print('Enter a name for each secret. Names are VISIBLE in the SVG metadata.')
    print('Values are hidden. Enter @ followed by a path for a private-key file; @@ starts a literal @ value.')
    print('Press Enter on an empty name when finished.')
    items = {}
    while True:
        name = input('Name (blank to finish): ').strip()
        if not name:
            break
        if name in items:
            print('That name is already used; choose another.', file=sys.stderr)
            continue
        value = secret_prompt('Secret (or @path): ')
        if value.startswith('@@'):
            value = value[1:]
        elif value.startswith('@'):
            try:
                value = Path(value[1:]).expanduser().read_text(encoding='utf-8')
            except (OSError, UnicodeError) as exc:
                raise VaultError('Cannot read the specified secret file.') from exc
        if not value:
            raise VaultError('Empty secrets are not supported.')
        items[name] = value
    return items


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('create', help='read secrets interactively and create vault images')
    create.add_argument('image', nargs='?', type=Path, default=DEFAULT_IMAGE,
                        help='trusted source SVG, PNG or JPEG (default: repository sig.svg)')
    create.add_argument('--svg', type=Path, help='new SVG vault file')
    create.add_argument('--png', type=Path, help='new PNG vault file')
    create.add_argument('--jpg', type=Path, help='new JPEG vault file')
    extract = commands.add_parser('open', help='decrypt secrets from a vault image')
    extract.add_argument('image', type=Path)
    extract.add_argument('--output', type=Path, help='write plaintext JSON to a new private file instead of the terminal')
    restore = commands.add_parser('recover-svg', help='recover the encrypted SVG from a PNG or JPEG')
    restore.add_argument('image', type=Path)
    restore.add_argument('output', type=Path, help='new SVG file; no decryption is performed')
    args = parser.parse_args(argv)
    try:
        if args.command in ('create', 'open') and not sys.stdin.isatty():
            raise VaultError('A private interactive terminal is required for secret entry and passphrases.')
        if args.command == 'create':
            paths = {name: getattr(args, name) for name in ('svg', 'png', 'jpg') if getattr(args, name)}
            if not paths:
                raise VaultError('Choose at least one output: --svg, --png or --jpg.')
            resolved = [p.resolve() for p in paths.values()]
            if len(set(resolved)) != len(resolved) or args.image.resolve() in resolved:
                raise VaultError('Output paths must be distinct and different from the input.')
            for kind, path in paths.items():
                valid = {'.svg'} if kind == 'svg' else ({'.png'} if kind == 'png' else {'.jpg', '.jpeg'})
                if path.suffix.lower() not in valid:
                    raise VaultError(f'Output for --{kind} must have the matching file extension.')
                if path.exists():
                    raise VaultError(f'Refusing to overwrite: {path}')
            if args.image.stat().st_size > MAX_IMAGE:
                raise VaultError('Input image is too large (maximum 24 MiB).')
            source = args.image.read_bytes()
            items = collect_items()
            if not items:
                raise VaultError('No secrets entered; nothing was saved.')
            password = secret_prompt('New vault passphrase (at least 12 characters): ')
            if len(password) < 12:
                raise VaultError('Choose a passphrase of at least 12 characters.')
            if password != secret_prompt('Repeat vault passphrase: '):
                raise VaultError('Passphrases did not match; nothing was saved.')
            outputs = create_outputs(source, items, password, svg='svg' in paths, png='png' in paths, jpg='jpg' in paths)
            for name, path in paths.items():
                save_new(path, outputs[name])
                print(f'Created {path}')
            print('Keep separate backups. Secret names are visible; image services may strip metadata.')
        elif args.command == 'recover-svg':
            if args.image.stat().st_size > MAX_ARCHIVE:
                raise VaultError('Vault image is too large (maximum 80 MiB).')
            save_new(args.output, recover_svg(args.image.read_bytes()))
            print(f'Recovered encrypted SVG: {args.output}')
        else:
            if args.image.stat().st_size > MAX_ARCHIVE:
                raise VaultError('Vault image is too large (maximum 80 MiB).')
            svg = recover_svg(args.image.read_bytes())
            items = decrypt_items(svg_envelope(svg), secret_prompt('Vault passphrase: '))
            data = json.dumps(items, ensure_ascii=False, indent=2).encode('utf-8') + b'\n'
            if args.output:
                save_new(args.output, data)
                print(f'Plaintext saved to {args.output}; protect and delete it when finished.')
            else:
                print('WARNING: displaying secrets in your terminal.', file=sys.stderr)
                sys.stdout.buffer.write(data)
        return 0
    except (VaultError, OSError, EOFError) as exc:
        print(f'Error: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
