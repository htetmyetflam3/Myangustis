#!/bin/bash
# Description: Interactive script to select a commit hash from .commit,
# create a new branch named after that hash from main, and overlay the files from that commit.
# Usage: ./pick.sh

set -e

COMMIT_LOG=".commit"
BASE_BRANCH="main"

# --- 1. Pre-flight Checks ---
if [ ! -d ".git" ]; then
    echo "[ERR] Not a git repository."
    exit 1
fi

if [ ! -f "$COMMIT_LOG" ]; then
    echo "[ERR] Log file $COMMIT_LOG not found."
    exit 1
fi

# Ensure working directory is clean before switching branches
if [ -n "$(git status --porcelain)" ]; then
    echo "[ERR] Working tree has uncommitted changes. Please commit or stash them first."
    exit 1
fi

# --- 2. Read Last 5 Commits from .commit ---
mapfile -t LINES < <(grep -v "^timestamp" "$COMMIT_LOG" | tail -n 5)

NUM_ENTRIES=${#LINES[@]}
if [ "$NUM_ENTRIES" -eq 0 ]; then
    echo "[ERR] No commit records found in $COMMIT_LOG."
    exit 1
fi

echo "======================================================"
echo "          SELECT A COMMIT TO APPLY TO MAIN            "
echo "======================================================"

for i in "${!LINES[@]}"; do
    IFS=$'\t' read -r TS BRANCH HASH MSG <<< "${LINES[$i]}"
    printf "[%d] %s | branch: %s | %s | %s\n" "$((i+1))" "$HASH" "$BRANCH" "$TS" "$MSG"
done

echo ""
read -p "Select commit [1-$NUM_ENTRIES] (or 'q' to quit): " CHOICE

if [[ "$CHOICE" =~ ^[qQ]$ ]]; then
    echo "Aborted."
    exit 0
fi

if ! [[ "$CHOICE" =~ ^[1-5]$ ]] || [ "$CHOICE" -lt 1 ] || [ "$CHOICE" -gt "$NUM_ENTRIES" ]; then
    echo "[ERR] Invalid selection."
    exit 1
fi

# Extract selected commit details
INDEX=$((CHOICE - 1))
IFS=$'\t' read -r SEL_TS SEL_BRANCH SEL_HASH SEL_MSG <<< "${LINES[$INDEX]}"

echo ""
echo "[OK] Selected: $SEL_HASH on branch '$SEL_BRANCH' ($SEL_MSG)"

# Automatically set the new branch name to the selected commit hash
NEW_BRANCH="$SEL_HASH"

# Fallback to master if main branch isn't named main
if ! git rev-parse --verify "$BASE_BRANCH" >/dev/null 2>&1; then
    if git rev-parse --verify "master" >/dev/null 2>&1; then
        BASE_BRANCH="master"
    else
        echo "[ERR] Base branch '$BASE_BRANCH' does not exist."
        exit 1
    fi
fi

# --- 3. Branch & File Overlay Operation ---
echo ""
echo "[1/4] Switching to baseline branch '$BASE_BRANCH'..."
git checkout "$BASE_BRANCH"

echo "[2/4] Creating new branch '$NEW_BRANCH' from '$BASE_BRANCH'..."
git checkout -b "$NEW_BRANCH"

echo "[3/4] Overlaying files from commit $SEL_HASH..."
# Restores all files present in $SEL_HASH onto current working directory
# without deleting main's other directories.
git restore --source="$SEL_HASH" .

echo "[4/4] Committing updates on '$NEW_BRANCH'..."
git add -A
git commit -m "Sync files from $SEL_HASH ($SEL_BRANCH): $SEL_MSG"

echo ""
echo "[OK] Successfully created branch '$NEW_BRANCH' with changes from $SEL_HASH!"
git log --oneline -1
