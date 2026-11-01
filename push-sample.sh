#!/usr/bin/env bash
#
# push-sample.sh — watch a slow git push from the outside.
#
# Appends one line per run to ~/push-watch.log. The "remote=" column comes
# from git ls-remote, i.e. from GitHub itself, so it tells you whether the
# push actually landed regardless of what your local refs say.
#
# Usage:
#   ./push-sample.sh [repo-dir] [branch]
#
#   ./push-sample.sh ~/trash                 # branch defaults to trash
#   ./push-sample.sh ~/trash trash
#   watch -n 300 ./push-sample.sh ~/trash    # sample every 5 min
#
# Run it every 5-10 minutes while a big push is in flight.

set -u

REPO="${1:-$HOME/trash}"
BRANCH="${2:-trash}"
LOG="${PUSH_WATCH_LOG:-$HOME/push-watch.log}"

cd "$REPO" 2>/dev/null || {
  echo "push-sample.sh: no repo at $REPO" >&2
  exit 1
}

head_sha=$(git rev-parse --short HEAD 2>/dev/null) || {
  echo "push-sample.sh: $REPO is not a git repo" >&2
  exit 1
}

remote_sha=$(timeout 25 git ls-remote origin "refs/heads/$BRANCH" 2>/dev/null | cut -c1-7)
[ -z "$remote_sha" ] && remote_sha="(unreachable)"

if [ "$remote_sha" != "(unreachable)" ] && [ -n "$remote_sha" ]; then
  ahead=$(git rev-list --count "$remote_sha..HEAD" 2>/dev/null || echo "?")
else
  ahead="?"
fi

printf '%s  branch=%s  head=%s  remote=%s  ahead=%s  packs=%s\n' \
  "$(TZ=Asia/Rangoon date '+%F %H:%M:%S')" \
  "$BRANCH" \
  "$head_sha" \
  "$remote_sha" \
  "$ahead" \
  "$(du -sh .git/objects/pack 2>/dev/null | cut -f1)" \
  >> "$LOG"

tail -n 1 "$LOG"

if [ "$remote_sha" = "$head_sha" ]; then
  echo "-> push COMPLETE: origin/$BRANCH is at $head_sha"
fi
