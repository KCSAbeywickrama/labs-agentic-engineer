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

// Display-only reads of the phase scope for the "Cut version" ceremony
// (#370/#372). The BACKEND is the authority — it computes the real scope at
// the tag it cuts and its gate refuses an incomplete design; these parsers
// only preview the same facts from the draft so the drawer can say what the
// click will do.

/** The `phase <N>` a design.cell declares; null when undeclared. */
export function parseCellPhase(cell: string): number | null {
  const m = /^\s*phase\s+(\d+)\s*$/m.exec(cell);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The PRD Phasing entry's story numbers for one phase ([] when unparsable). */
export function parsePhasingStories(prd: string, phase: number): number[] {
  const lines = prd.split(/\r?\n/);
  let inSection = false;
  let currentPhase = 0;
  const out = new Set<number>();
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      inSection = /^##\s+phasing/i.test(line);
      continue;
    }
    if (!inSection) continue;
    const phaseMatch = /\bphase\s+(\d+)\b/i.exec(line);
    if (phaseMatch) currentPhase = Number(phaseMatch[1]);
    if (currentPhase !== phase) continue;
    const storiesMatch = /\bstories:\s*([\d,\s]+)/i.exec(line);
    if (storiesMatch?.[1]) {
      for (const tok of storiesMatch[1].split(/[\s,]+/)) {
        const n = Number(tok);
        if (Number.isInteger(n) && n > 0) out.add(n);
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** The predictive next version label: v<latest+1>, or v1 with no tags yet.
 *  The backend assigns the real number at cut time — display only. */
export function nextVersionLabel(latestTag: string | undefined | null): string {
  const m = latestTag ? /^v(\d+)$/.exec(latestTag) : null;
  return m ? `v${Number(m[1]) + 1}` : "v1";
}
