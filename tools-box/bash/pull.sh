#!/usr/bin/env bash
# FILE: .bin/pull.sh — one process, two commands, in this order.
#
#   ./.bin/pull.sh          git pull; if it resolved, chmod +x the .bin scripts
#   ./.bin/pull.sh full     ... and refresh the alias block in ~/.bashrc
#
# The order is the point: a pull that conflicts must NOT be followed by
# anything, so the chmod is gated on the tree being whole. A merge or rebase
# that git left half-applied counts as unresolved too — `git pull` can exit 0
# in that state, and chmod-ing files in the middle of one is how a broken
# checkout gets its scripts marked executable and its conflicts forgotten.
#
#   exit 0   pulled (or already up to date), .bin/ is executable
#   exit 1   nothing was chmod'ed; the output above says what git objected to
set -uo pipefail

. "$(dirname "$0")/lib.sh"
cd "$REPO_ROOT" || exit 1

FULL=0
case "${1:-}" in
  "")            ;;
  full|true|yes|1) FULL=1 ;;
  -h|--help)
    awk '/^# FILE:/{on=1} /^set -u/{exit} on {sub(/^# ?/,""); print}' "$0"
    exit 0 ;;
  *) die "unknown argument: $1 — the only argument is 'full' (boolean, false by default)" ;;
esac

[ -d "$REPO_ROOT/.git" ] || die "$REPO_ROOT is not a git checkout"

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
info "git pull  ${C_DIM}($BRANCH)${C_RST}"
RC=0
OUT="$(git pull 2>&1)" || RC=$?

# Two failures are wedged configuration rather than a real conflict, and both
# are worth one explicit retry before the reader has to parse git's paragraph:
#
#   * no upstream on this branch — this repo's work branches have none, and
#     `git pull` answers with instructions instead of doing the obvious thing;
#   * "divergent branches" — git >= 2.34 refuses to guess between merge and
#     rebase, so a plain `git pull` fails on any branch both ahead and behind.
#     The retry is the pre-2.34 meaning of the command: merge.
#
# A retry that conflicts lands exactly where any other conflict would: nothing
# is chmod'ed, and the tree is left for a human.
if [ "$RC" -ne 0 ]; then
  case "$OUT" in
    *"no tracking information"*)
      dim "no upstream for $BRANCH — retrying as: git pull --ff-only origin $BRANCH"
      RC=0
      OUT="$(git pull --ff-only origin "$BRANCH" 2>&1)" || RC=$?
      ;;
    *"reconcile divergent"*)
      dim "divergent branches — retrying as: git pull --no-rebase (merge)"
      RC=0
      OUT="$(git pull --no-rebase --no-edit 2>&1)" || RC=$?
      ;;
  esac
fi

printf '%s\n' "$OUT" | sed 's/^/    /'

if [ "$RC" -ne 0 ]; then
  warn "pull did not resolve — .bin/ left untouched"
  dim "resolve it, commit, then run pull again"
  exit 1
fi

# `git pull` can exit 0 with a merge in progress, and a half-applied rebase is
# worse. Both mean "not resolved", so the chmod waits for a whole tree.
MID="$(git diff --name-only --diff-filter=U 2>/dev/null)"
for _m in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD rebase-merge rebase-apply; do
  [ -e "$REPO_ROOT/.git/$_m" ] && MID="$MID .git/$_m"
done
if [ -n "${MID// /}" ]; then
  warn "unresolved state after pull — .bin/ left untouched"
  dim "git status   ·   then: git add -A && git commit, and run pull again"
  exit 1
fi

# "chmod +x on the entire .bin dir" means every SCRIPT in it: a blanket
# chmod -R +x would mark scripts.db and directories executable too, which is
# not what anyone wants. The walk follows subdirectories (.bin/node/*.mjs
# counts) and leaves data files alone.
N=0
while IFS= read -r _f; do
  chmod +x "$_f" 2>/dev/null && N=$((N + 1))
done < <(find "$BIN_DIR" -type f \( -name '*.sh' -o -name '*.js' -o -name '*.mjs' \) 2>/dev/null)
# test.sh at the repo root is a symlink to .bin/test.sh; chmod follows it.
[ -e "$REPO_ROOT/test.sh" ] && chmod +x "$BIN_DIR/test.sh" 2>/dev/null
ok "chmod +x — $N script(s) under .bin/"

if [ "$FULL" -eq 1 ]; then
  info "refreshing the shell commands (full)"
  rc_install || exit 1
fi
