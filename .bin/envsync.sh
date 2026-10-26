#!/bin/sh
# .bin/envsync.sh — push .env to GitHub repo secrets (and optional variables),
# so you don't have to paste one-by-one through the web UI.
#
# Default: every KEY=VALUE in .env becomes an Actions REPOSITORY SECRET.
# If .envvars exists (same format), those KEYs become non-secret VARIABLES
# instead (visible in the Actions UI; use for non-sensitive values only).
#
# Usage:
#   ./.bin/envsync.sh              # push .env as secrets (+ .envvars as vars if present)
#   ./.bin/envsync.sh -n           # dry run — list what would change, do nothing
#   ./.bin/envsync.sh -f other.env # read a different env file
#   ./.bin/envsync.sh -e prod      # target a deployment environment, not repo
#   ./.bin/envsync.sh -d           # also DELETE GitHub secrets not present in .env
#   ./.bin/envsync.sh --pull       # write GitHub vars back to .env (secrets can't be read back)
#
# Needs gh (GitHub CLI) authenticated with repo admin rights.
# POSIX sh — works under busybox ash, dash, bash.

set -eu

# Source lib.sh. Script may live in .bin/ OR in tools-box/bash/ alongside lib.sh,
# and callers may symlink it. Walk up from $0 and fall back to a peer lookup.
_script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ -f "$_script_dir/lib.sh" ]; then
  . "$_script_dir/lib.sh"
elif [ -f "$_script_dir/../tools-box/bash/lib.sh" ]; then
  . "$_script_dir/../tools-box/bash/lib.sh"
elif [ -f "$REPO_ROOT/.bin/lib.sh" ]; then
  . "$REPO_ROOT/.bin/lib.sh"
else
  # Last resort: sibling to tools-box
  for _cand in "$_script_dir/../../tools-box/bash/lib.sh" \
               "$(pwd)/tools-box/bash/lib.sh" \
               "$(pwd)/.bin/lib.sh"; do
    if [ -f "$_cand" ]; then . "$_cand"; break; fi
  done
fi
[ -n "${REPO_ROOT:-}" ] || { printf 'envsync: cannot locate lib.sh / repo root\n' >&2; exit 1; }
cd "$REPO_ROOT"

need gh

# --- defaults -----------------------------------------------------------------
ENV_FILE="$REPO_ROOT/.env"
VARS_FILE="$REPO_ROOT/.envvars"
ENVIRONMENT=""
DRY_RUN=0
DELETE_STALE=0
PULL_MODE=0
APP="actions"   # actions | codespaces | dependabot

# --- args ---------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    -n|--dry-run) DRY_RUN=1; shift ;;
    -d|--delete) DELETE_STALE=1; shift ;;
    --pull) PULL_MODE=1; shift ;;
    -f|--file) ENV_FILE="${2:-}"; shift 2 ;;
    -e|--env) ENVIRONMENT="${2:-}"; shift 2 ;;
    -a|--app) APP="${2:-}"; shift 2 ;;
    --vars-file) VARS_FILE="${2:-}"; shift 2 ;;
    -h|--help)
      cat <<USAGE
envsync.sh — push .env to GitHub repo secrets/variables

  -n, --dry-run         show what would change, do nothing
  -d, --delete          delete GitHub secrets not present in .env (stale cleanup)
  -f, --file PATH       env file to sync (default: .env)
      --vars-file PATH  non-secret variables file (default: .envvars)
  -e, --env NAME        target a deployment environment instead of the repo
  -a, --app NAME        app scope: actions (default) | codespaces | dependabot
      --pull            write GitHub *variables* back to .envvars (secrets cannot be read)
  -h, --help            this message

Examples:
  ./.bin/envsync.sh                     # push .env as repo Actions secrets
  ./.bin/envsync.sh -e staging -n       # dry-run against the 'staging' environment
  ./.bin/envsync.sh -d                  # push and remove stale secrets
USAGE
      exit 0 ;;
    *) die "unknown arg: $1 (use -h for help)" ;;
  esac
done

# --- repo + gh preflight -------------------------------------------------------
if ! gh auth status >/dev/null 2>&1; then
  die "gh not authenticated. Run: gh auth login"
fi

REPO_SLUG="$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null || true)"
[ -n "$REPO_SLUG" ] || REPO_SLUG="$(git remote get-url origin 2>/dev/null | sed -n 's#.*[:/]\([^/]*\/[^/]*\)\(\.git\)\{0,1\}$#\1#p')"
[ -n "$REPO_SLUG" ] || die "cannot determine repo slug (no git remote?)"
info "repo: $REPO_SLUG"

# gh variable set was added in gh 2.36; use gh api on older versions.
GH_VER="$(gh --version 2>/dev/null | head -1 | awk '{print $3}')"
GH_VER_MAJOR="$(printf '%s' "$GH_VER" | cut -d. -f1)"
GH_VER_MINOR="$(printf '%s' "$GH_VER" | cut -d. -f2)"
HAS_VAR_CMD=0
if [ "${GH_VER_MAJOR:-0}" -gt 2 ] 2>/dev/null || \
   { [ "${GH_VER_MAJOR:-0}" -eq 2 ] && [ "${GH_VER_MINOR:-0}" -ge 36 ]; } 2>/dev/null; then
  HAS_VAR_CMD=1
fi

# --- gh command wrappers (scoped to repo + optional env) -----------------------
GH_SCOPE="-R $REPO_SLUG"
[ -n "$ENVIRONMENT" ] && GH_SCOPE="$GH_SCOPE -e $ENVIRONMENT"

gh_list_secrets() {
  # NAMES only, one per line
  # shellcheck disable=SC2086
  gh secret list $GH_SCOPE --app "$APP" --json name -q '.[].name' 2>/dev/null
}

gh_set_secret() {
  _name="$1"; _file="$2"
  if [ "$DRY_RUN" = 1 ]; then return 0; fi
  # shellcheck disable=SC2086
  gh secret set "$_name" $GH_SCOPE --app "$APP" < "$_file" >/dev/null
}

gh_delete_secret() {
  _name="$1"
  if [ "$DRY_RUN" = 1 ]; then return 0; fi
  # shellcheck disable=SC2086
  gh secret delete "$_name" $GH_SCOPE --app "$APP" --yes >/dev/null 2>&1 || true
}

# Variables API paths differ by whether we target an environment.
# gh variable set doesn't accept --app, so we always target actions-level vars
# (which is the only place non-secret variables exist on GitHub anyway).
var_api_base() {
  if [ -n "$ENVIRONMENT" ]; then
    printf '/repos/%s/environments/%s/variables' "$REPO_SLUG" "$ENVIRONMENT"
  else
    printf '/repos/%s/actions/variables' "$REPO_SLUG"
  fi
}

gh_var_cmd() {
  # $@ passed to `gh variable` with the right scope
  if [ "$HAS_VAR_CMD" = 1 ]; then
    # shellcheck disable=SC2086
    gh variable "$@" $([ -n "$ENVIRONMENT" ] && printf -- '-e %s' "$ENVIRONMENT") -R "$REPO_SLUG"
  else
    return 127
  fi
}

gh_list_vars() {
  if [ "$HAS_VAR_CMD" = 1 ]; then
    gh_var_cmd list --json name -q '.[].name' 2>/dev/null
  else
    gh api --paginate "$(var_api_base)?per_page=100" \
      --jq '.variables[].name' 2>/dev/null
  fi
}

gh_set_var() {
  _name="$1"; _val="$2"
  if [ "$DRY_RUN" = 1 ]; then return 0; fi
  if [ "$HAS_VAR_CMD" = 1 ]; then
    gh_var_cmd set "$_name" --body "$_val" >/dev/null
  else
    # Create or update via API. Try POST (create); on 409, PATCH (update).
    _payload="$(printf '{"name":"%s","value":"%s"}' \
      "$_name" "$(printf '%s' "$_val" | sed 's/\\/\\\\/g; s/"/\\"/g')")"
    _resp="$(gh api -X POST "$(var_api_base)" --input - --silent -i 2>&1 <<-JSON || true
	$_payload
	JSON
)"
    if printf '%s' "$_resp" | grep -q 'HTTP/.* 409'; then
      gh api -X PATCH "$(var_api_base)/$_name" \
        --raw-field "name=$_name" \
        --raw-field "value=$_val" --silent >/dev/null
    fi
  fi
}

gh_delete_var() {
  _name="$1"
  if [ "$DRY_RUN" = 1 ]; then return 0; fi
  if [ "$HAS_VAR_CMD" = 1 ]; then
    gh_var_cmd delete "$_name" --yes >/dev/null 2>&1 || true
  else
    gh api -X DELETE "$(var_api_base)/$_name" --silent >/dev/null 2>&1 || true
  fi
}

gh_get_var() {
  # Only possible for non-secret variables. Prints the value to stdout.
  _name="$1"
  if [ "$HAS_VAR_CMD" = 1 ]; then
    gh_var_cmd list --json name,value -q ".[] | select(.name==\"$_name\") | .value" 2>/dev/null | head -1
  else
    gh api "$(var_api_base)/$_name" --jq '.value' 2>/dev/null | head -1
  fi
}

# --- env parsing --------------------------------------------------------------
# Yields lines of "KEY\tVALUE" to stdout. Handles:
#   - blank lines and # comments skipped
#   - export KEY=VALUE
#   - KEY=VALUE wrapped in single or double quotes (quotes stripped)
#   - VALUE containing = signs (only first = splits)
#   - empty values: KEY=
# Does NOT perform shell expansion (no ${VAR}, no backticks). That's by design:
# we ship the literal .env line, same shape any Node dotenv loader would see.
parse_env() {
  _f="$1"
  [ -f "$_f" ] || return 0
  awk '
    /^[[:space:]]*#/ { next }                   # comment
    /^[[:space:]]*$/ { next }                   # blank
    {
      # strip leading "export "
      sub(/^[[:space:]]*(export[[:space:]]+)?/, "", $0)
      # split into key/value at first =
      eq = index($0, "=")
      if (eq == 0) { next }                    # no =, not a KV line
      key = substr($0, 1, eq-1)
      val = substr($0, eq+1)
      # strip surrounding whitespace from key
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
      if (key !~ /^[A-Za-z_][A-Za-z0-9_]*$/) { next }
      # strip surrounding whitespace from value
      gsub(/^[[:space:]]+/, "", val)
      # trailing whitespace inside quotes is meaningful, so we are conservative:
      # only strip a trailing space outside quotes.
      # strip matching surrounding double or single quotes
      if (val ~ /^".*"$/) {
        val = substr(val, 2, length(val)-2)
      } else if (val ~ /^'\''.*'\''$/) {
        val = substr(val, 2, length(val)-2)
      }
      # output tab-separated for unambiguous downstream split
      printf "%s\t%s\n", key, val
    }
  ' "$_f"
}

# --- PULL mode ----------------------------------------------------------------
if [ "$PULL_MODE" = 1 ]; then
  info "pull: fetching GitHub variables → $VARS_FILE"
  warn "(secrets cannot be read back — push is one-way for secrets)"
  : > "$VARS_FILE.tmp.$$"
  if [ "$HAS_VAR_CMD" = 1 ] || gh api "$(var_api_base)" >/dev/null 2>&1; then
    for name in $(gh_list_vars); do
      val="$(gh_get_var "$name")"
      # Quote values that contain spaces/shell chars so round-trip is safe.
      case "$val" in
        *[\ \#\;\&\$\`\"\'\\]*|*"("*|*")"*)
          printf '%s="%s"\n' "$name" "$(printf '%s' "$val" | sed 's/"/\\"/g')" >> "$VARS_FILE.tmp.$$"
          ;;
        "")
          printf '%s=\n' "$name" >> "$VARS_FILE.tmp.$$"
          ;;
        *)
          printf '%s=%s\n' "$name" "$val" >> "$VARS_FILE.tmp.$$"
          ;;
      esac
      ok "var: $name"
    done
  else
    warn "no variables endpoint available (older gh, no repo perms, or no vars set)"
  fi
  mv "$VARS_FILE.tmp.$$" "$VARS_FILE"
  ok "wrote $VARS_FILE"
  exit 0
fi

# --- read local env ------------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  die "$ENV_FILE not found — nothing to sync. Run from the repo root, or pass -f PATH."
fi

SECRETS_TMP="$(mktemp -t envsync-secrets.XXXXXX)"
VARS_TMP="$(mktemp -t envsync-vars.XXXXXX)"
trap 'rm -f "$SECRETS_TMP" "$VARS_TMP" "$SECRETS_TMP".* "$VARS_TMP".*' EXIT INT TERM

# Vars file is optional. We build a set of "these KEYs are variables, not secrets"
# so they don't get pushed as secrets.
VAR_KEYS=""
if [ -f "$VARS_FILE" ]; then
  parse_env "$VARS_FILE" | awk -F'\t' '{print $1}' > "$VARS_TMP"
  VAR_KEYS="$(cat "$VARS_TMP")"
fi

# Every KV in the main env file becomes a secret, UNLESS its key appears in the
# vars file, in which case it becomes a variable.
SECRET_COUNT=0
VAR_COUNT=0
SECRET_KEYS_TMP="$(mktemp -t envsync-skeys.XXXXXX)"
trap 'rm -f "$SECRETS_TMP" "$VARS_TMP" "$SECRET_KEYS_TMP"' EXIT INT TERM

# Build one temp file per KV so we can `gh secret set NAME < file` without
# leaking values through argv.
SEC_VAL_DIR="$(mktemp -d -t envsync-val.XXXXXX)"
VAR_VAL_DIR="$(mktemp -d -t envsync-vval.XXXXXX)"
trap 'rm -rf "$SEC_VAL_DIR" "$VAR_VAL_DIR" "$SECRETS_TMP" "$VARS_TMP" "$SECRET_KEYS_TMP"' EXIT INT TERM

is_var_key() {
  _k="$1"
  grep -Fxq "$_k" "$VARS_TMP" 2>/dev/null
}

while IFS=$(printf '\t') read -r key val; do
  [ -z "$key" ] && continue
  if is_var_key "$key"; then
    printf '%s' "$val" > "$VAR_VAL_DIR/$key"
    printf '%s\n' "$key" >> "$VARS_TMP.post"
    VAR_COUNT=$((VAR_COUNT + 1))
  else
    printf '%s' "$val" > "$SEC_VAL_DIR/$key"
    printf '%s\n' "$key" >> "$SECRET_KEYS_TMP"
    SECRET_COUNT=$((SECRET_COUNT + 1))
  fi
done <<EOF
$(parse_env "$ENV_FILE")
EOF

# Pull in any KVs from VARS_FILE that aren't in the main env (they only exist
# as variables — e.g. already on GitHub but no longer in .env).
if [ -f "$VARS_FILE" ]; then
  while IFS=$(printf '\t') read -r key val; do
    [ -z "$key" ] && continue
    if [ ! -f "$VAR_VAL_DIR/$key" ]; then
      printf '%s' "$val" > "$VAR_VAL_DIR/$key"
      printf '%s\n' "$key" >> "$VARS_TMP.post"
      VAR_COUNT=$((VAR_COUNT + 1))
    fi
  done <<EOF
$(parse_env "$VARS_FILE")
EOF
fi

info "local file:  $(rel "$ENV_FILE")  ($SECRET_COUNT secrets, $VAR_COUNT variables)"
[ -f "$VARS_FILE" ] && info "vars file:   $(rel "$VARS_FILE")"
[ -n "$ENVIRONMENT" ] && info "environment: $ENVIRONMENT"
info "app scope:   $APP"
[ "$DRY_RUN" = 1 ] && warn "DRY RUN — nothing written"

# --- compare with remote and sync secrets --------------------------------------
info "fetching existing GitHub secrets…"
REMOTE_SEC_TMP="$(mktemp -t envsync-rsec.XXXXXX)"
gh_list_secrets > "$REMOTE_SEC_TMP" || {
  warn "could not list existing secrets (bad token scope? need 'repo' admin rights)"
  info "continuing with set-only, no delete"
  : > "$REMOTE_SEC_TMP"
}

set_count=0
skip_count=0
del_count=0

# SET every local secret. We can't read back the existing value, so every push
# fires (GitHub compares hashes server-side and skips unchanged ones).
for key in $(cat "$SECRET_KEYS_TMP" 2>/dev/null); do
  [ -z "$key" ] && continue
  if [ "$DRY_RUN" = 1 ]; then
    ok "SET secret   $key"
    set_count=$((set_count + 1))
  else
    if gh_set_secret "$key" "$SEC_VAL_DIR/$key"; then
      ok "set secret   $key"
      set_count=$((set_count + 1))
    else
      warn "failed:     $key"
    fi
  fi
done

# DELETE stale secrets (only with -d or --delete).
if [ "$DELETE_STALE" = 1 ]; then
  for rem in $(cat "$REMOTE_SEC_TMP" 2>/dev/null); do
    [ -z "$rem" ] && continue
    if ! grep -Fxq "$rem" "$SECRET_KEYS_TMP" 2>/dev/null; then
      # Never delete the GITHUB_TOKEN* automatic secrets, or any GITHUB_ vars
      # GitHub reserves.
      case "$rem" in
        GITHUB_TOKEN|GITHUB_*) continue ;;
      esac
      if [ "$DRY_RUN" = 1 ]; then
        warn "DELETE secret $rem (not in local .env)"
      else
        gh_delete_secret "$rem" && warn "deleted stale secret $rem" || warn "could not delete $rem"
      fi
      del_count=$((del_count + 1))
    fi
  done
else
  # Even without -d, mention stale secrets so the user knows they're there.
  for rem in $(cat "$REMOTE_SEC_TMP" 2>/dev/null); do
    [ -z "$rem" ] && continue
    if ! grep -Fxq "$rem" "$SECRET_KEYS_TMP" 2>/dev/null; then
      case "$rem" in GITHUB_TOKEN|GITHUB_*) continue ;; esac
      dim "remote only: secret   $rem  (rerun with -d to delete)"
    fi
  done
fi

# --- variables (non-secret) ----------------------------------------------------
info "fetching existing GitHub variables…"
REMOTE_VAR_TMP="$(mktemp -t envsync-rvar.XXXXXX)"
gh_list_vars > "$REMOTE_VAR_TMP" 2>/dev/null || : > "$REMOTE_VAR_TMP"

vset=0
vskip=0
vdel=0
for key in $(cat "$VARS_TMP.post" 2>/dev/null); do
  [ -z "$key" ] && continue
  if [ "$DRY_RUN" = 1 ]; then
    ok "SET var      $key"
  else
    val="$(cat "$VAR_VAL_DIR/$key")"
    if gh_set_var "$key" "$val"; then
      ok "set var      $key"
    else
      warn "var failed:  $key"
    fi
  fi
  vset=$((vset + 1))
done

if [ "$DELETE_STALE" = 1 ]; then
  for rem in $(cat "$REMOTE_VAR_TMP" 2>/dev/null); do
    [ -z "$rem" ] && continue
    if ! grep -Fxq "$rem" "$VARS_TMP.post" 2>/dev/null; then
      if [ "$DRY_RUN" = 1 ]; then
        warn "DELETE var   $rem (not in local vars file)"
      else
        gh_delete_var "$rem" && warn "deleted stale var $rem" || warn "could not delete var $rem"
      fi
      vdel=$((vdel + 1))
    fi
  done
else
  for rem in $(cat "$REMOTE_VAR_TMP" 2>/dev/null); do
    [ -z "$rem" ] && continue
    if ! grep -Fxq "$rem" "$VARS_TMP.post" 2>/dev/null; then
      dim "remote only: variable $rem  (rerun with -d to delete)"
    fi
  done
fi

# --- summary -------------------------------------------------------------------
if [ "$DRY_RUN" = 1 ]; then
  echo
  info "dry-run summary"
  printf '  secrets:   %d to set, %d stale to delete (-d)\n' "$set_count" "$del_count"
  printf '  variables: %d to set, %d stale to delete (-d)\n' "$vset" "$vdel"
  echo
  dim "nothing was written to GitHub"
else
  echo
  ok "synced"
  printf '  secrets:   %d set, %d deleted\n' "$set_count" "$del_count"
  printf '  variables: %d set, %d deleted\n' "$vset" "$vdel"
  echo
  dim "tip: verify at https://github.com/$REPO_SLUG/settings/secrets/actions"
fi

rm -rf "$SEC_VAL_DIR" "$VAR_VAL_DIR"
