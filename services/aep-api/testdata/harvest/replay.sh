#!/usr/bin/env bash

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

#
# replay.sh — re-hit every captured aep-api response and write NORMALIZED bodies
# to a target dir, so the Phase 0b (internal/app.Build) refactor can be proven
# behavior-preserving with a plain `diff`:
#
#   TOKEN=$(cat token.txt) ./replay.sh before   # on the pre-refactor binary
#   ...do the 0b refactor, rebuild, restart aep-api...
#   TOKEN=$(cat token.txt) ./replay.sh after
#   diff -ru before after                        # must be empty
#
# This is the 0a "diff oracle". It is NOT a maintained e2e suite — it targets the
# live local cluster and the two seeded projects (hello-world-api / apii) that
# existed on 2026-07-01. Re-harvest (see README) if that data changes.
#
# Inputs (all env, with defaults):
#   TOKEN      end-user Thunder bearer (REQUIRED). Or set TOKEN_FILE to a path.
#   BASE       BFF origin.            default: http://localhost:9090
#   ROOM       X-Room-Id for collab/validate. default: spec-default-hello-world-api
#   CURL / JQ  tool paths.            default: curl / jq
# Arg:
#   $1         output dir.            default: ./replayed
#
# The route list + per-entry method/params come from manifest.json (this dir),
# so replay stays in lock-step with what was harvested.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$HERE/manifest.json"

OUTDIR="${1:-./replayed}"
BASE="${BASE:-http://localhost:9090}"
ROOM="${ROOM:-spec-default-hello-world-api}"
CURL="${CURL:-curl}"
JQ="${JQ:-jq}"

if [ -z "${TOKEN:-}" ] && [ -n "${TOKEN_FILE:-}" ]; then TOKEN="$(cat "$TOKEN_FILE")"; fi
if [ -z "${TOKEN:-}" ]; then
  echo "ERROR: set TOKEN (a valid end-user bearer) or TOKEN_FILE=<path>." >&2
  exit 2
fi
if [ ! -f "$MANIFEST" ]; then echo "ERROR: manifest.json not found at $MANIFEST" >&2; exit 2; fi

mkdir -p "$OUTDIR"

# Normalizer: blanks volatile content so the before/after diff is stable.
# - value-based (key-agnostic): any UUID, any ISO-8601 timestamp, and the
#   absolute host in a `$schema`-style "http(s)://host/api/v1/*.json" URL.
# - key-based: `seq` — the progress/* event streams (get-task-*-progress) carry
#   a monotonically-increasing per-emit sequence counter that shifts on every
#   read (a presentation counter, not payload state), so it is blanked by name.
NORMALIZE='
  def norm:
    walk(
      if type == "object" then
        with_entries(if (.key | ascii_downcase) == "seq" then .value = "<seq>" else . end)
      elif type == "string" then
        if test("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
          then "<uuid>"
        elif test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}")
          then "<ts>"
        elif test("^https?://[^/]+/api/v1/.*\\.json$")
          then sub("^https?://[^/]+"; "<host>")
        else .
        end
      else . end
    );
  norm
'

status_file="$OUTDIR/_status.txt"
: > "$status_file"

# Iterate manifest as TAB-separated: name \t method \t path \t golden_file
while IFS=$'\t' read -r name method path golden; do
  [ -z "$name" ] && continue
  [ "$golden" = "-" ] && { echo "SKIP  $name"; continue; }

  url="$BASE/api/v1$path"
  args=(-sS --noproxy '*' -m 25 -X "$method" -w $'\n__CODE__%{http_code}')

  # Per-entry auth / headers / body, keyed by the harvested name.
  case "$name" in
    err_401_projects)        : ;;                                             # deliberately no auth
    err_422_create_project)  args+=(-H "Authorization: Bearer $TOKEN"
                                    -H "Content-Type: application/json" -d '{}') ;;
    get_collab_validate)     args+=(-H "Authorization: Bearer $TOKEN"
                                    -H "X-Room-Id: $ROOM") ;;
    *)                       args+=(-H "Authorization: Bearer $TOKEN") ;;
  esac

  raw=$("$CURL" "${args[@]}" "$url")
  code="${raw##*__CODE__}"
  body="${raw%$'\n'__CODE__*}"

  out="$OUTDIR/$name.json"
  if printf '%s' "$body" | "$JQ" empty >/dev/null 2>&1; then
    printf '%s' "$body" | "$JQ" "$NORMALIZE" > "$out"
  else
    out="$OUTDIR/$name.txt"
    printf '%s\n' "$body" > "$out"
  fi
  printf '%-40s %-4s %-4s %s\n' "$name" "$method" "$code" "$path" | tee -a "$status_file"
done < <("$JQ" -r '.[] | [.name, .method, .path, .golden_file] | @tsv' "$MANIFEST")

echo "---"
echo "wrote normalized bodies + _status.txt to: $OUTDIR"
