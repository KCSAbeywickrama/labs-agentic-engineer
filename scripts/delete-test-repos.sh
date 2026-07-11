#!/bin/bash
# Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
#
# WSO2 LLC. licenses this file to you under the Apache License,
# Version 2.0 (the "License"); you may not use this file except
# in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.

# delete-test-repos.sh — PERMANENTLY delete repositories from a test GitHub org.
#
# Usage: scripts/delete-test-repos.sh <org>
#
# Interactive: lists every repo in the org, lets you pick (e.g. "1,3,5-8" or
# "all"), then requires the org name typed back plus a final "yes" before
# deleting. Deletion is irreversible — intended only for throwaway test orgs.

set -euo pipefail

usage() {
  echo "Usage: $(basename "$0") <org>" >&2
  echo "Interactively delete repositories from the given GitHub organization." >&2
  exit 2
}

abort() {
  echo "Aborted. Nothing was deleted." >&2
  exit 1
}

[[ $# -eq 1 && -n "$1" ]] || usage
ORG="$1"

command -v gh >/dev/null 2>&1 || {
  echo "Error: gh CLI is required (https://cli.github.com)." >&2
  exit 1
}

# --- Auth: prompt for a token so it never lands in shell history ------------
echo "Repos will be deleted with the token you provide (only this script sees it)."
read -rsp "GitHub token with delete_repo access (empty = use existing gh login): " TOKEN
echo
if [[ -n "$TOKEN" ]]; then
  export GH_TOKEN="$TOKEN"
elif ! gh auth status >/dev/null 2>&1; then
  echo "Error: no token given and no gh login found. Run 'gh auth login' or re-run and paste a token." >&2
  exit 1
fi

# Classic tokens report scopes in a header; verify delete_repo when we can.
# Fine-grained PATs omit the header — permission problems then surface per repo.
SCOPES="$(gh api -i user 2>/dev/null | awk -F': ' 'tolower($1) == "x-oauth-scopes" {print $2}' | tr -d '\r')"
if [[ -n "$SCOPES" && "$SCOPES" != *delete_repo* ]]; then
  echo "Error: this token lacks the 'delete_repo' scope (has: $SCOPES)." >&2
  echo "Fix: use a PAT that includes delete_repo, or run 'gh auth refresh -h github.com -s delete_repo'" >&2
  echo "     (note: refresh adds the scope to your stored gh login for all future runs)." >&2
  exit 1
fi

gh api "orgs/$ORG" --jq .login >/dev/null 2>&1 || {
  echo "Error: cannot access organization '$ORG' with this token (missing, misspelled, or no permission)." >&2
  exit 1
}

# --- List every repo (paginated — no silent truncation) ---------------------
echo "Fetching all repositories in '$ORG'..."
NAMES=()
LABELS=()
while IFS=$'\t' read -r name archived fork; do
  label="$name"
  [[ "$archived" == "true" ]] && label+=" [archived]"
  [[ "$fork" == "true" ]] && label+=" [fork]"
  NAMES+=("$name")
  LABELS+=("$label")
done < <(gh api --paginate "orgs/$ORG/repos?per_page=100&type=all" \
  --jq '.[] | [.name, .archived, .fork] | @tsv' | sort)

TOTAL=${#NAMES[@]}
if [[ $TOTAL -eq 0 ]]; then
  echo "No repositories found in '$ORG'. Nothing to do."
  exit 0
fi

echo
echo "Repositories in '$ORG' ($TOTAL):"
for i in "${!LABELS[@]}"; do
  printf '  %3d) %s\n' "$((i + 1))" "${LABELS[$i]}"
done

# --- Select ------------------------------------------------------------------
echo
read -rp "Select repos to DELETE (e.g. 1,3,5-8 or 'all'): " SELECTION
SELECTION="${SELECTION//[[:space:]]/}"
[[ -n "$SELECTION" ]] || abort

PICKED=()   # de-duplicated 0-based indices, in input order
declare -A SEEN=()
add_index() {
  local n="$1"
  if (( n < 1 || n > TOTAL )); then
    echo "Error: '$n' is out of range (1-$TOTAL)." >&2
    abort
  fi
  if [[ -z "${SEEN[$n]:-}" ]]; then
    SEEN[$n]=1
    PICKED+=("$((n - 1))")
  fi
}

if [[ "$SELECTION" == "all" ]]; then
  for ((n = 1; n <= TOTAL; n++)); do add_index "$n"; done
else
  IFS=',' read -ra PARTS <<< "$SELECTION"
  for part in "${PARTS[@]}"; do
    if [[ "$part" =~ ^[0-9]+$ ]]; then
      add_index "$part"
    elif [[ "$part" =~ ^([0-9]+)-([0-9]+)$ ]]; then
      lo="${BASH_REMATCH[1]}"; hi="${BASH_REMATCH[2]}"
      if (( lo > hi )); then
        echo "Error: bad range '$part' (start > end)." >&2
        abort
      fi
      for ((n = lo; n <= hi; n++)); do add_index "$n"; done
    else
      echo "Error: cannot parse '$part' — use numbers, ranges (5-8), or 'all'." >&2
      abort
    fi
  done
fi

# --- Confirm (two-step) ------------------------------------------------------
echo
echo "This will PERMANENTLY delete ${#PICKED[@]} of $TOTAL repositories from '$ORG':"
for idx in "${PICKED[@]}"; do
  echo "  - ${LABELS[$idx]}"
done
echo
read -rp "Type the organization name to continue: " TYPED
if [[ "$TYPED" != "$ORG" ]]; then
  echo "Organization name mismatch." >&2
  abort
fi
read -rp "Final confirmation — type 'yes' to delete these ${#PICKED[@]} repos: " FINAL
[[ "$FINAL" == "yes" ]] || abort

# --- Delete (continue on error, summarize) -----------------------------------
echo
DELETED=0
FAILURES=()
for idx in "${PICKED[@]}"; do
  repo="${NAMES[$idx]}"
  if err="$(gh api -X DELETE "repos/$ORG/$repo" 2>&1)"; then
    echo "  ✓ $repo"
    DELETED=$((DELETED + 1))
  else
    echo "  ✗ $repo — $err"
    FAILURES+=("$repo: $err")
  fi
done

echo
echo "Done: $DELETED deleted, ${#FAILURES[@]} failed."
if [[ ${#FAILURES[@]} -gt 0 ]]; then
  echo "Failures:" >&2
  for f in "${FAILURES[@]}"; do
    echo "  - $f" >&2
  done
  echo "Hint: if errors say 'Must have admin rights' or 403, the token lacks delete permission on those repos." >&2
  exit 1
fi
