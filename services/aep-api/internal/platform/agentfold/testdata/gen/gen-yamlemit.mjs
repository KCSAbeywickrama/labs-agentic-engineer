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

// Regenerates ../yamlemit_golden.json: the byte-parity lock between
// agentfold's yamlemit.go and the REAL npm yaml package (the version
// packages/agent-stream resolves — the one FileBundle.setFrontmatterField
// stringifies with). Run from anywhere:
//
//   node services/aep-api/internal/platform/agentfold/testdata/gen/gen-yamlemit.mjs
//
// Document encoding in the fixture (JSON cannot carry key order on objects,
// -0, or Infinity):
//   map    → {"$map": [[key, value], ...]}   (order-preserving)
//   seq    → plain JSON array
//   number → {"$num": "<ECMA literal>"}      ("-0", "Infinity", "NaN", ...)
//   string | boolean | null → plain JSON
// Cases named "UNSUPPORTED-..." are documents the Go subset emitter must
// REFUSE loudly (want records what npm emits, for reference).

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..');
const require = createRequire(import.meta.url);
const yaml = require(join(repoRoot, 'packages', 'agent-stream', 'node_modules', 'yaml'));

// ---- doc encoding ------------------------------------------------------------

function encodeValue(v) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') {
    return { $num: Object.is(v, -0) ? '-0' : String(v) };
  }
  if (Array.isArray(v)) return v.map(encodeValue);
  if (v instanceof Map) {
    return { $map: [...v.entries()].map(([k, val]) => [k, encodeValue(val)]) };
  }
  throw new Error(`unencodable value: ${v}`);
}

/** Build the plain JS object npm stringify consumes from an ordered Map tree. */
function toPlain(v) {
  if (v instanceof Map) {
    const o = {};
    for (const [k, val] of v.entries()) o[k] = toPlain(val);
    return o;
  }
  if (Array.isArray(v)) return v.map(toPlain);
  return v;
}

const m = (...pairs) => new Map(pairs);

// ---- the case table ------------------------------------------------------------

const words = (n) => Array.from({ length: n }, (_, i) => `word${i % 7}`).join(' ');

/** @type {[string, Map<string, unknown>][]} */
const cases = [
  // scalars & core-schema quoting
  ['null-value', m(['a', null])],
  ['bool-true', m(['a', true])],
  ['bool-false', m(['a', false])],
  ['empty-string', m(['a', ''])],
  ['str-true', m(['a', 'true'])],
  ['str-false-caps', m(['a', 'FALSE'])],
  ['str-int', m(['a', '42'])],
  ['str-negint', m(['a', '-42'])],
  ['str-plusint', m(['a', '+7'])],
  ['str-float', m(['a', '1.5'])],
  ['str-dotfloat', m(['a', '.5'])],
  ['str-traildot', m(['a', '10.'])],
  ['str-exp', m(['a', '1e5'])],
  ['str-exp2', m(['a', '.5e-3'])],
  ['str-hex', m(['a', '0x1a'])],
  ['str-oct', m(['a', '0o17'])],
  ['str-inf', m(['a', '.inf'])],
  ['str-neginf', m(['a', '-.Inf'])],
  ['str-nan', m(['a', '.NaN'])],
  ['str-tilde', m(['a', '~'])],
  ['str-null-word', m(['a', 'Null'])],
  ['str-not-int', m(['a', '42x'])],
  ['str-not-float', m(['a', '1.5.3'])],
  // plain-scalar forbidden shapes
  ['colon-space', m(['a', 'key: value'])],
  ['colon-nospace', m(['a', 'key:value'])],
  ['trail-colon', m(['a', 'x:'])],
  ['lead-space', m(['a', ' x'])],
  ['trail-space', m(['a', 'x '])],
  ['lead-tab', m(['a', '\tx'])],
  ['mid-tab', m(['a', 'x\ty'])],
  ['hash-lead', m(['a', '#tag'])],
  ['hash-after-space', m(['a', 'x #y'])],
  ['hash-nospace', m(['a', 'x#y'])],
  ['dash-solo', m(['a', '-'])],
  ['dash-space', m(['a', '- x'])],
  ['dash-nospace', m(['a', '-x'])],
  ['qmark-solo', m(['a', '?'])],
  ['qmark-nospace', m(['a', '?x'])],
  ['qmark-space', m(['a', '? x'])],
  ['docmark', m(['a', '---x'])],
  ['docmark-exact', m(['a', '---'])],
  ['dots', m(['a', '...'])],
  ['at', m(['a', '@x'])], ['bang', m(['a', '!x'])], ['amp', m(['a', '&x'])],
  ['star', m(['a', '*x'])], ['pct', m(['a', '%x'])], ['bracket', m(['a', '[x'])],
  ['brace', m(['a', '{x'])], ['comma', m(['a', ',x'])], ['pipe', m(['a', '|x'])],
  ['gt', m(['a', '>x'])], ['backtick', m(['a', '`x'])],
  // quote choice
  ['apostrophe', m(['a', "it's"])],
  ['dquote', m(['a', 'say "hi"'])],
  ['both-quotes', m(['a', `mix '" here`])],
  ['dquote-forced-single', m(['a', '"quoted"'])],
  ['squote-lead', m(['a', "'lead"])],
  ['both-lead', m(['a', `'"x`])],
  // numbers
  ['num-int', m(['a', 42])],
  ['num-neg', m(['a', -7])],
  ['num-float', m(['a', 1.5])],
  ['num-negzero', m(['a', -0])],
  ['num-tiny', m(['a', 1e-7])],
  ['num-small-fixed', m(['a', 1e-5])],
  ['num-e21', m(['a', 1e21])],
  ['num-e20', m(['a', 1e20])],
  ['num-e300', m(['a', 1e300])],
  ['num-big-precision', m(['a', 123456789012345678901234567890])],
  ['num-third', m(['a', 1 / 3])],
  ['num-max-safe', m(['a', 9007199254740991])],
  ['num-inf', m(['a', Infinity])],
  ['num-neg-inf', m(['a', -Infinity])],
  ['num-nan', m(['a', NaN])],
  // multiline → literal block scalars
  ['ml-basic', m(['a', 'line1\nline2'])],
  ['ml-trailnl', m(['a', 'line1\nline2\n'])],
  ['ml-2trailnl', m(['a', 'a\nb\n\n'])],
  ['ml-3trailnl', m(['a', 'a\nb\n\n\n'])],
  ['ml-blank-inside', m(['a', 'p1\n\np2'])],
  ['ml-2blank-inside', m(['a', 'p1\n\n\np2'])],
  ['ml-lead-nl', m(['a', '\nx'])],
  ['ml-2lead-nl', m(['a', '\n\nx'])],
  ['ml-lead-space', m(['a', '  a\nb'])],
  ['ml-lead-space-nl', m(['a', ' \na'])],
  ['ml-only-nl', m(['a', '\n'])],
  ['ml-mid-trailing-space', m(['a', 'a \nb'])],
  ['ml-indented-lines', m(['a', 'a\n  ind\n    deeper\nb'])],
  ['ml-endspace-lastline', m(['a', 'a\nb '])],
  ['ml-quoted-trailws-short', m(['a', 'a\nb\n  '])],
  ['ml-quoted-trailws-long', m(['a', `${words(10)}\nsecond line of it\n  `])],
  ['ml-quoted-trailtab', m(['a', 'a\nb\n\t'])],
  ['ml-with-quotes', m(['a', 'he said "hi"\nand \'bye\''])],
  ['ml-crlf', m(['a', 'a\r\nb'])],
  ['ml-cr-only', m(['a', 'a\rb'])],
  // folding: plain
  ['fold-plain-79', m(['a', `${'x'.repeat(75)} end`])],
  ['fold-plain-long', m(['a', `${words(20)} end`])],
  ['fold-plain-nospace', m(['a', 'x'.repeat(120)])],
  ['fold-plain-doublespace', m(['a', `${'word  word'.repeat(12)} end`])],
  ['fold-longkey-shortval', m([`k${'k'.repeat(64)}`, 'short value'])],
  ['fold-longkey-longval', m([`k${'k'.repeat(64)}`, `${words(18)} tail`])],
  ['fold-key-59', m([`k${'k'.repeat(58)}`, `${words(18)} tail`])],
  ['fold-key-60', m([`k${'k'.repeat(59)}`, `${words(18)} tail`])],
  ['fold-key-61', m([`k${'k'.repeat(60)}`, `${words(18)} tail`])],
  ['fold-boundary-76', m(['description', `${words(11)} abcde`])],
  ['fold-boundary-77', m(['description', `${words(11)} abcdef`])],
  ['fold-boundary-78', m(['description', `${words(11)} abcdefg`])],
  // folding: quoted
  ['fold-quoted-long', m(['a', `${words(18)} end: x`])],
  ['fold-quoted-tab-escapes', m(['a', `\t${words(16)} and\tmore words here to push it over`])],
  ['fold-dq-backslashes', m(['a', `C:\\path\\to\\thing ${words(14)} : end`])],
  ['fold-sq-long', m(['a', `"${words(18)} end"`])],
  // unicode & UTF-16 length semantics
  ['emoji-short', m(['a', '🎉 party'])],
  ['emoji-fold', m(['a', `${'🎉🎉🎉 '.repeat(12)}end of the emoji line`])],
  ['emoji-fold-boundary', m(['a', `${'🚀'.repeat(35)} tail words here`])],
  ['cjk-fold', m(['a', `${'漢字 '.repeat(25)}end`])],
  ['nbsp-value', m(['a', 'x y'])],
  ['nel-value', m(['a', 'xy'])],
  ['ls-value', m(['a', 'x y'])],
  ['combining', m(['a', 'café latte'])],
  // control chars → double-quoted escapes
  ['ctrl-nul', m(['a', 'x y'])],
  ['ctrl-bel', m(['a', 'xy'])],
  ['ctrl-bs', m(['a', 'x\by'])],
  ['ctrl-vt', m(['a', 'xy'])],
  ['ctrl-ff', m(['a', 'x\fy'])],
  ['ctrl-esc', m(['a', 'xy'])],
  ['ctrl-so', m(['a', 'xy'])],
  ['ctrl-us', m(['a', 'xy'])],
  ['ctrl-del', m(['a', 'xy'])],
  ['ctrl-c1', m(['a', 'xy'])],
  ['ctrl-cr', m(['a', 'x\ry'])],
  ['ctrl-crlf', m(['a', 'x\r\ny'])],
  ['ctrl-mix-long', m(['a', `alpha ${words(15)} omega`])],
  // double-quoted multiline (kept escapes vs folded real newlines)
  ['dq-ml-short', m(['a', 'x \ny'])],
  ['dq-ml-exactly-39json', m(['a', `x \n${'y'.repeat(31)}`])],
  ['dq-ml-40json', m(['a', `x \n${'y'.repeat(32)}`])],
  ['dq-ml-long', m(['a', `has trailing space \nand a second line long enough to fold for real`])],
  ['dq-ml-multi-nl', m(['a', `one \n\n\ntwo ${words(8)}\nthree lines here `])],
  ['dq-ml-nl-before-quote', m(['a', `ends with newline ${words(8)} \n`])],
  ['dq-ml-space-after-nl', m(['a', `lead \n after ${words(10)} tail`])],
  // sequences
  ['seq-empty', m(['a', []])],
  ['seq-strings', m(['a', ['x', 'y', 'z']])],
  ['seq-quote-items', m(['a', ['true', '- x', "it's", '']])],
  ['seq-mixed-scalars', m(['a', ['x', 42, true, null]])],
  ['seq-long-item', m(['a', [`${words(18)} end`]])],
  ['seq-ml-item', m(['a', ['l1\nl2', 'plain']])],
  ['seq-emoji-fold', m(['a', [`${'🎈'.repeat(38)} tail`]])],
  ['skillsApplied', m(['skillsApplied', ['high-level-architecture', 'openapi-conventions', 'excalidraw-wireframes']])],
  // nested maps
  ['nested-map', m(['a', m(['b', 'c'], ['d', 'e'])])],
  ['nested-empty-map', m(['a', m()])],
  ['deep-nest', m(['a', m(['b', m(['c', 'd'])])])],
  ['nested-fold', m(['outer', m(['inner', `${words(18)} deep tail`])])],
  ['nested-seq', m(['a', m(['list', ['one', 'two']])])],
  ['nested-null', m(['a', m(['b', null])])],
  // keys
  ['key-space', m(['a b', 1])],
  ['key-true', m(['true', 1])],
  ['key-num-float', m(['1.5', 'x'])],
  ['key-colon', m(['x:y', 1])],
  ['key-colon-space', m(['x: y', 1])],
  ['key-empty', m(['', 1])],
  ['key-hash', m(['#x', 1])],
  ['key-dash', m(['- x', 1])],
  ['key-quote', m([`it's`, 1])],
  ['key-dquote', m(['say "hi"', 1])],
  ['key-newline', m(['a\nb', 1])],
  ['key-emoji', m(['🎉key', 'v'])],
  ['key-nbsp', m(['a b', 'v'])],
  ['key-unicode', m(['schlüssel', 'v'])],
  ['key-docmark', m(['---x', 'v'])],
  ['key-tab', m(['a\tb', 'v'])],
  ['key-ctrl', m(['ab', 'v'])],
  ['key-long-60', m(['k'.repeat(60), 'v'])],
  ['key-long-1024', m(['k'.repeat(1024), 'v'])],
  // multiple pairs / whole documents
  ['multi-pair', m(['name', 'my-skill'], ['version', 3], ['stable', true], ['tags', ['a', 'b']])],
  ['all-null', m(['a', null], ['b', null])],
  ['empty-doc', m()],
  ['fm-typical', m(
    ['title', 'Requirements'],
    ['description', 'What the system must do, phrased as testable statements.'],
    ['skillsApplied', ['high-level-architecture']],
    ['version', 2],
  )],
  // documents the Go subset emitter REFUSES (want kept for reference)
  ['UNSUPPORTED-folded-block', m(['a', `short\n${words(25)} end`])],
  ['UNSUPPORTED-folded-block-2', m(['a', `${'x'.repeat(90)}\nshort`])],
  ['UNSUPPORTED-seq-of-maps', m(['a', [m(['b', 'c'])]])],
  ['UNSUPPORTED-key-int-like', m(['0', 'x'], ['z', 'y'])],
  ['UNSUPPORTED-key-over-1024', m(['k'.repeat(1025), 'v'])],
];

// Seeded pseudo-random single-line docs (always inside the supported subset).
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260706);
const pool = [
  'a', 'b', 'z', 'Z', '0', '9', ' ', ' ', ' ', ':', '#', "'", '"', '-', '?',
  '.', ',', '[', ']', '{', '}', '&', '*', '!', '|', '>', '%', '@', '`', '\t',
  '\\', '/', '=', '+', '~', 'é', 'ü', '漢', '🎉', ' ', ' ',
];
const rndString = (maxLen) => {
  const n = Math.floor(rnd() * maxLen);
  let s = '';
  for (let i = 0; i < n; i++) s += pool[Math.floor(rnd() * pool.length)];
  return s;
};
const rndKey = () => {
  const keys = ['name', 'desc', 'a b', 'true', 'x:y', "it's", 'K'.repeat(1 + Math.floor(rnd() * 40)), `k${Math.floor(rnd() * 1000)}x`];
  return keys[Math.floor(rnd() * keys.length)];
};
const rndScalar = () => {
  const r = rnd();
  if (r < 0.55) return rndString(140);
  if (r < 0.7) return Math.floor(rnd() * 2e6 - 1e6) / 10 ** Math.floor(rnd() * 4);
  if (r < 0.8) return rnd() < 0.5;
  if (r < 0.87) return null;
  return rndString(30);
};
for (let i = 0; i < 120; i++) {
  const doc = new Map();
  const pairs = 1 + Math.floor(rnd() * 4);
  for (let p = 0; p < pairs; p++) {
    const key = rndKey();
    const r = rnd();
    if (r < 0.7) doc.set(key, rndScalar());
    else if (r < 0.85) doc.set(key, Array.from({ length: Math.floor(rnd() * 4) }, () => rndString(60)));
    else doc.set(key, new Map([[rndKey(), rndScalar()]]));
  }
  cases.push([`random-${String(i).padStart(3, '0')}`, doc]);
}

// ---- emit the fixture ------------------------------------------------------------

const out = [];
const seen = new Set();
for (const [name, doc] of cases) {
  if (seen.has(name)) throw new Error(`duplicate case name ${name}`);
  seen.add(name);
  out.push({ name, doc: encodeValue(doc), want: yaml.stringify(toPlain(doc)) });
}
const target = process.env.OUT ?? join(here, '..', 'yamlemit_golden.json');
writeFileSync(target, `${JSON.stringify(out, null, 1)}\n`);
console.log(`wrote ${out.length} cases to ${target} (yaml ${require(join(repoRoot, 'packages', 'agent-stream', 'node_modules', 'yaml', 'package.json')).version})`);
