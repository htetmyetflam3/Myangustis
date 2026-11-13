# Personal image vault (experimental)

This is separate from the engine and its dictionaries. You enter **your own
named secrets** interactively: passwords, API tokens, the key that unlocks a
JSON file, or an SSH private key. It does not open the engine's JSON, collect
its contents, or create an `.env`.

## Important limits

- **Experimental, not independently audited.** For important secrets, a
  reputable password manager is safer. Hiding data in an image is not security.
- Secret **values** are encrypted with AES-256-GCM using a key derived from your
  passphrase with scrypt. Use a long, unique passphrase and keep a separate,
  secure backup of it. Forgetting it means the secrets cannot be recovered.
  Encryption authenticates the secret data, not the surrounding artwork or labels.
- The **names/labels are visible** to anyone who inspects the SVG or its
  embedded copy in PNG/JPEG metadata. Don't put a secret in a name.
- PNG and JPEG have no editable SVG layers. The script embeds a recoverable
  copy of the encrypted SVG as image metadata. Anyone can see/extract that SVG;
  its secret values still require your passphrase.
- Many websites, messengers, image editors, screenshots, and format converters
  strip or change metadata. The picture may still look normal while the vault
  is gone. Keep independent backups of the original vault files and test recovery.
- Use only trusted SVG artwork. Rasterizing an SVG can access referenced local
  or remote resources. Don't open untrusted SVGs, even as vaults.
- Don't commit vaults or plaintext exports to Git, share them publicly, or assume
  the pictures are private just because the data is invisible. The image includes
  the original artwork as well as the encrypted vault and can be much larger.
- If input and output are both PNG or both JPEG, the original image bytes are
  preserved apart from added metadata. Converting formats or rasterizing SVG can
  change rendering; JPEG is lossy and has no transparency.

## Create

Run locally, not in a shared terminal. Secret input requires an interactive
terminal with echo disabled. `uv` installs this script's dependencies
for the command; alternatively install `cryptography`, `Pillow` and `resvg-py`
in your Python environment.

```bash
uv run tools-box/python/image_vault.py create \
  --svg /private/vault.svg --png /private/vault.png --jpg /private/vault.jpg
```

This uses the repository's `sig.svg` by default without modifying it. To use
another trusted source image, provide its path after `create` instead. You may
choose any one or more outputs. Use a **clean source image**; existing vault
images aren't modified or overwritten. Enter a name, then a
secret with hidden input. For a multiline private key already stored in a file,
enter `@` followed by its path at the secret prompt. `@@` starts a literal
secret with `@`. A blank name ends entry. Enter your new vault passphrase twice.
SVG groups preserve each item name as an ID/label, but contain no visible shapes.

## Open or recover

```bash
# Displays your decrypted secrets in the terminal after asking for the passphrase.
uv run tools-box/python/image_vault.py open /private/vault.png

# Recovers the encrypted SVG from image metadata (no passphrase required).
uv run tools-box/python/image_vault.py recover-svg /private/vault.jpg /private/recovered.svg

# Decrypt into a NEW plaintext JSON file with restrictive permissions instead:
uv run tools-box/python/image_vault.py open /private/recovered.svg --output /private/secrets.json
```

A plaintext export is optional and contains real secrets: protect it and delete
it when finished. The tool won't overwrite output files. It does not upload
anything itself; vault authentication, sync, backup and safe storage are your
responsibility. If metadata has already been stripped, the raster image cannot
recover it.
