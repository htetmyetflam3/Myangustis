# Personal SVG raster store

This tool uses your repository `sig.svg` artwork by default; the original is
never overwritten. You enter your own names and values interactively: passwords,
API keys, the key that unlocks a JSON file, or an SSH private key. The tool
does **not** scan `.env` or open the engine's JSON.

## How entries are stored

For each entry the tool appends one SVG group **without an ID**. It contains two
small, fully transparent PNG images at the same position, in this order:

1. The lower raster carries the entry's name and value as plain text in its PNG
   `Comment` data; that PNG is base64-encoded inside the SVG.
2. The upper raster is meaningless and fully transparent.

No IDs are added to the new groups or their images. Existing IDs in `sig.svg`
are left alone because the artwork may depend on them. The tool reads the
first raster of each matching group to retrieve the entries. The extra groups
have no visible effect on the original artwork in the tested renderer.

**This is obscurity, not encryption.** Anyone who inspects and decodes the SVG
can recover the names and values without a password. Don't put the image in Git,
share it publicly, or assume an export will strip the data. The tool saves new
files with owner-only permissions where supported; access to your unlocked
account or a copy of the file still exposes the secrets.

Copy the original SVG file byte-for-byte for backup, and test opening the copy.
Editors, optimizers, re-exporting, or conversion may remove or change the raster
groups and lose some or all data. They may also **preserve** it, so stripping is
not a reliable safety net for accidental sharing. There is no integrity check
that can reliably detect every removed group. Keep the file outside project
folders that you might bulk-delete.

## Create

Run locally in a private interactive terminal. `uv` installs this script's
legacy-compatibility dependency; alternatively install `cryptography` in your
Python environment.

```bash
uv run tools-box/python/image_vault.py create --svg ~/my-private-image.svg
```

Enter a name and a value for each entry. Values are hidden while typed, but they
are **not encrypted** in the SVG. Enter `@` followed by a path to read a
multiline SSH key from an existing local file. `@@` begins a literal value with
`@`. Leave the name empty when done. No vault passphrase is required.

Use another trusted SVG by passing its path after `create`. The output must be
a **new** `.svg` file; the script refuses to overwrite the input or any file.
The new format is SVG-only: the script no longer creates PNG or JPEG outputs.

## Retrieve or add

```bash
# Print the stored names and values; don't do this in a shared terminal.
uv run tools-box/python/image_vault.py open ~/my-private-image.svg

# Add NEW names to a separate SVG; the first file remains unchanged.
uv run tools-box/python/image_vault.py add ~/my-private-image.svg --svg ~/my-private-image-2.svg
```

`add` refuses duplicate names and does not currently change or remove existing
entries. Check the new file and its backup before deciding what to do with the
older file: both contain readable secrets. `open --output /private/out.json`
optionally writes a new owner-only plaintext JSON file instead of printing;
protect and delete that export when finished.

## Earlier encrypted images

Images made with the previous version are not converted automatically. `open`
still reads the old SVG/PNG/JPEG vaults with their **existing passphrase**;
`recover-svg` can recover the earlier SVG from its PNG/JPEG metadata. New SVG
raster entries have no passphrase. The tool does not upload files or manage
backups for you.
