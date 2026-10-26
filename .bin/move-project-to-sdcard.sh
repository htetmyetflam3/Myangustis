#!/bin/sh
# .bin/move-project-to-sdcard.sh — run ONCE in Acode's terminal (Alpine side).
# Moves the project from Acode's internal storage (/public/Myangustis)
# to shared storage (/sdcard/Myangustis) so Debian can see it at /mnt/android/Myangustis.
# After this, re-open the project in Acode by browsing to /sdcard/Myangustis.

set -e

SRC="/public/Myangustis"
DST="/sdcard/Myangustis"

if [ ! -d "$SRC" ]; then
  echo "source $SRC not found — already moved?"
  exit 1
fi

if [ -d "$DST" ]; then
  echo "destination $DST already exists. Merge? (this will NOT overwrite existing files)"
  echo "press Ctrl+C to abort, Enter to continue"
  read -r _
else
  mkdir -p "$DST"
fi

echo "--- copying $SRC -> $DST (preserving everything except node_modules + .git) ---"
# Use tar+exclude to be safe with symlinks/perms; skip node_modules (reinstall on Debian side).
# We skip .git too so the move is fast — you can git clone fresh on the sdcard side if preferred.
cd "$SRC"
tar cf - --exclude=node_modules --exclude=.git --exclude=.venv --exclude=__pycache__ . \
  | (cd "$DST" && tar xf -)

echo "--- copy done. Verifying ---"
ls -la "$DST" | head -30

echo
echo "========================================================================"
echo " NEXT STEPS:"
echo "  1. In Acode: File → Open Folder → browse to /sdcard/Myangustis and open it."
echo "     (Acode can browse /sdcard via its file picker; internal storage root)."
echo "  2. DO NOT delete $SRC yet — keep a backup until you confirm everything works"
echo "     from the new location. Delete it later with:  rm -rf $SRC"
echo "  3. After dsh is working, run 'dsh npm install' once from the new project"
echo "     so node_modules is glibc-linked (won't work from Acode's musl terminal)."
echo "========================================================================"
