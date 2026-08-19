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


/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Per-screen grouping over a compiled grid scene. The DSL compiler stamps
 * every element with `customData.screen`, which is what makes these questions
 * answerable without geometry guesswork: which elements are the first
 * screen's (focus it on open), and which screens did the last edit touch
 * (follow the agent's work).
 */

/**
 * Whether two versions of the same element render identically. Compiler
 * output is plain JSON built field-by-field in a fixed order, so serialising
 * is a stable way to catch every rendered difference — geometry, colours,
 * text — without enumerating fields that would drift as the compiler grows.
 */
function sameContent(a: any, b: any): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function screenOf(el: any): string | null {
  const s = el?.customData?.screen;
  return typeof s === "string" && s.length > 0 ? s : null;
}

/** The elements belonging to any of `names`, in scene order. */
export function elementsOfScreens(elements: any[], names: readonly string[]): any[] {
  if (names.length === 0) return [];
  const want = new Set(names);
  return elements.filter((el) => {
    const s = screenOf(el);
    return s !== null && want.has(s);
  });
}

/**
 * The screen highest on the canvas — screens stack in one column, so this is
 * the first one the author declared. Null when nothing is tagged.
 */
export function firstScreenName(elements: any[]): string | null {
  let best: { name: string; y: number } | null = null;
  for (const el of elements) {
    const s = screenOf(el);
    if (s === null) continue;
    const y = typeof el.y === "number" ? el.y : Number.POSITIVE_INFINITY;
    if (best === null || y < best.y) best = { name: s, y };
  }
  return best?.name ?? null;
}

/**
 * Screens whose element set differs between two scenes — an element added,
 * removed, or re-versioned — in canvas order (topmost first). Empty when
 * nothing changed or there is no previous scene to compare against; the
 * caller treats "empty" as "leave the viewport alone".
 *
 * Matched ids are compared by CONTENT, not by `version`: the compiler stamps
 * `version: 1` on every element and builds ids from kind + label + position,
 * so a restyle (a button gaining `primary`, say) keeps both the id and the
 * version while the rendered colours change — comparing versions would report
 * no change and strand the reader on another screen. Both sides are
 * deterministic compiler output, so a structural comparison is stable.
 */
export function changedScreenNames(prev: any[] | null, next: any[]): string[] {
  if (!prev) return [];
  const prevById = new Map<string, any>();
  for (const el of prev) prevById.set(el.id, el);
  const nextById = new Map<string, any>();
  for (const el of next) nextById.set(el.id, el);

  const changed = new Map<string, number>(); // name → topmost y, for ordering
  const mark = (el: any) => {
    const s = screenOf(el);
    if (s === null) return;
    const y = typeof el.y === "number" ? el.y : Number.POSITIVE_INFINITY;
    const cur = changed.get(s);
    if (cur === undefined || y < cur) changed.set(s, y);
  };

  for (const el of next) {
    const before = prevById.get(el.id);
    if (!before || !sameContent(before, el)) mark(el);
  }
  for (const el of prev) {
    if (!nextById.has(el.id)) mark(el);
  }

  return [...changed.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
}

/**
 * What to bring into view when a wireframe opens: the whole first screen,
 * plus the top slice of the second so its title (and a sliver of frame) shows
 * beneath as the cue that there is more below. Fitting the first screen ALONE
 * only shows that cue by accident — a wide panel fits the screen at a zoom
 * whose height ends exactly at its bottom edge — so the peek band is part of
 * the target box on purpose. Falls back to the first screen when there is no
 * second, and to nothing when the scene carries no screen tags.
 */
export function openingFocusElements(elements: any[]): any[] {
  const first = firstScreenName(elements);
  if (!first) return [];
  const firstEls = elementsOfScreens(elements, [first]);

  // The second screen is the tagged screen whose topmost element is the
  // lowest one still ABOVE nothing else — i.e. the next in canvas order.
  const firstBottom = Math.max(...firstEls.map((e) => (e.y ?? 0) + (e.height ?? 0)));
  let second: { name: string; top: number } | null = null;
  for (const el of elements) {
    const s = screenOf(el);
    if (s === null || s === first) continue;
    const y = typeof el.y === "number" ? el.y : Number.POSITIVE_INFINITY;
    if (second === null || y < second.top) second = { name: s, top: y };
  }
  if (!second) return firstEls;

  // Peek band: from the second screen's top down to a fixed depth — enough
  // for its title block and the first ~10% of its frame.
  const PEEK = firstBottom - (firstEls.length ? Math.min(...firstEls.map((e) => e.y ?? 0)) : 0);
  const peekDepth = Math.max(80, PEEK * 0.12);
  // Only elements that END inside the band count: the second screen's frame
  // rectangle STARTS in the band but is a full screen tall, and letting it in
  // would fit both screens — the very thing this function exists to avoid.
  const bandBottom = second.top + peekDepth;
  const band = elementsOfScreens(elements, [second.name]).filter(
    (e) => typeof e.y === "number" && e.y + (e.height ?? 0) <= bandBottom,
  );
  // A zero-size marker at the band's bottom edge pins the fitted box to that
  // depth regardless of which second-screen elements happen to end inside it,
  // so a sliver of the second frame is always in view. It is only ever handed
  // to scrollToContent for its bounds — never added to the scene.
  const anchor = firstEls[0]!;
  const marker = { ...anchor, id: "__peek-marker", y: bandBottom, height: 0, width: 0 };
  return [...firstEls, ...band, marker];
}
