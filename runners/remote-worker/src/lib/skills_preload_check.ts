/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

/**
 * Did the skills we asked for actually register?
 *
 * The SDK's `skills:` option is a CONTEXT FILTER over discovered skills, not a
 * loader: a name matching nothing is dropped in silence. That is not a
 * hypothetical — a run shipped with `settingSources: []`, which disabled the
 * filesystem sources the project's `.claude/skills/` mirror lives in, so every
 * pinned skill resolved to nothing. The build still reported success. The agent
 * had found `go/SKILL.md` by grepping the tree, which looks like the feature
 * working and is exactly what it is not: guidance arriving by accident, subject
 * to whether the agent happens to go looking.
 *
 * The SDK does tell us — the `init` system message carries the resolved
 * `skills` list. Comparing what we asked for against what came back turns a
 * silent miss into a visible one, which is the difference between a
 * misconfiguration found in a log and one found in the shipped code.
 */

/** What the SDK resolved versus what the run asked for. */
export interface PreloadCheck {
  /** Requested names absent from the SDK's resolved set. */
  missing: string[];
  /** Requested names the SDK resolved. */
  resolved: string[];
}

/**
 * Compare the requested preload against the `init` message's `skills`.
 *
 * Plugin skills resolve under a `plugin:skill` qualifier, so a request for
 * `aep:aep` and a request for a bare mirrored name are matched the same way:
 * exact first, then by the segment after the colon. Matching the bare tail
 * avoids a false alarm when the SDK reports a name qualified differently than
 * we spelled it, and a false alarm here is worse than useless — it trains the
 * reader to ignore the line that matters.
 */
export function checkPreload(requested: readonly string[], resolvedSkills: readonly string[]): PreloadCheck {
  const present = new Set<string>();
  for (const s of resolvedSkills) {
    present.add(s);
    const tail = s.slice(s.indexOf(":") + 1);
    present.add(tail);
  }
  const missing: string[] = [];
  const resolved: string[] = [];
  for (const name of requested) {
    const tail = name.slice(name.indexOf(":") + 1);
    (present.has(name) || present.has(tail) ? resolved : missing).push(name);
  }
  return { missing, resolved };
}

/**
 * The warning a run emits when an allowlisted skill was never discovered.
 * Deliberately names the likely cause: the failure mode is a wiring one (a
 * setting source, a mirror that did not run), and whoever reads this line is
 * reading it because something downstream was subtly wrong, not because they
 * were looking here.
 */
export function preloadWarning(missing: readonly string[]): string {
  return (
    `[skills] ${missing.length} skill(s) the run allowed were never discovered and CANNOT be invoked: ` +
    `${missing.join(", ")}. The SDK's skills option is an allowlist over DISCOVERED skills — a name that ` +
    `matches nothing is dropped silently. ` +
    `Check that the project's .claude/skills/ mirror was written and that ` +
    `settingSources includes "project".`
  );
}
