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

// Regenerates ../frontmatter_bundle.json: END-TO-END fixtures recorded from
// the REAL @aep/agent-stream FileBundle (dist build) — each case runs ONE op
// against a seeded bundle and records the OpResult plus the file's post-op
// content. agentfold's Fold must reproduce both (content byte-for-byte;
// result code/status — messages are compared only where stable).
//
//   pnpm --filter @aep/agent-stream build   # if dist is stale
//   node services/aep-api/internal/platform/agentfold/testdata/gen/gen-frontmatter.mjs
//
// Cases named "UNSUPPORTED-..." are ops the TS bundle APPLIES but whose
// output agentfold refuses to reproduce (outside the yamlemit subset): the Go
// test asserts a typed loud error for those.

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..');
const { FileBundle } = await import(
  pathToFileURL(join(repoRoot, 'packages', 'agent-stream', 'dist', 'bundle.js')).href
);

const fmDoc = (fence, body = 'Body text.\n') => `---\n${fence}\n---\n${body}`;

/**
 * @type {{name: string, path?: string, content: string,
 *         op: 'frontmatter'|'add'|'edit', args: unknown[]}[]}
 */
const cases = [
  // -- setFrontmatterField ----------------------------------------------------
  { name: 'set-new-string', content: fmDoc('title: Hello'), op: 'frontmatter', args: ['status', 'draft'] },
  { name: 'replace-existing', content: fmDoc('title: Hello\nstatus: old'), op: 'frontmatter', args: ['status', 'new'] },
  { name: 'preserve-order', content: fmDoc('b: 2\na: 1\nc: 3'), op: 'frontmatter', args: ['a', 'mid'] },
  { name: 'set-array', content: fmDoc('title: T'), op: 'frontmatter', args: ['skillsApplied', ['high-level-architecture', 'openapi-conventions']] },
  { name: 'replace-array', content: fmDoc('tags:\n  - a\n  - b'), op: 'frontmatter', args: ['tags', ['x']] },
  { name: 'set-empty-array', content: fmDoc('title: T'), op: 'frontmatter', args: ['tags', []] },
  { name: 'set-number-int', content: fmDoc('title: T'), op: 'frontmatter', args: ['version', 3] },
  { name: 'set-number-float', content: fmDoc('title: T'), op: 'frontmatter', args: ['version', 2.5] },
  { name: 'set-bool', content: fmDoc('title: T'), op: 'frontmatter', args: ['stable', true] },
  { name: 'set-string-true', content: fmDoc('title: T'), op: 'frontmatter', args: ['flag', 'true'] },
  { name: 'set-string-int', content: fmDoc('title: T'), op: 'frontmatter', args: ['id', '042'] },
  { name: 'set-empty-string', content: fmDoc('title: T'), op: 'frontmatter', args: ['note', ''] },
  { name: 'set-colon-string', content: fmDoc('title: T'), op: 'frontmatter', args: ['note', 'a: b'] },
  { name: 'set-lead-space', content: fmDoc('title: T'), op: 'frontmatter', args: ['note', '  padded'] },
  { name: 'set-quotes', content: fmDoc('title: T'), op: 'frontmatter', args: ['note', `it's a "note"`] },
  { name: 'set-multiline', content: fmDoc('title: T'), op: 'frontmatter', args: ['note', 'line one\nline two'] },
  { name: 'set-crlf-value', content: fmDoc('title: T'), op: 'frontmatter', args: ['note', 'a\r\nb'] },
  { name: 'set-long-value', content: fmDoc('title: T'), op: 'frontmatter', args: ['description', 'The quick brown fox jumps over the lazy dog and keeps going through the forest at pace'] },
  { name: 'normalizes-quoted-source', content: fmDoc(`title: 'Hello: World'\ncount: 0x1A\nempty:`), op: 'frontmatter', args: ['x', 'y'] },
  { name: 'normalizes-flow-seq', content: fmDoc('tags: [a, b]'), op: 'frontmatter', args: ['x', 'y'] },
  { name: 'source-literal-block', content: fmDoc('note: |\n  line one\n  line two\ntitle: T'), op: 'frontmatter', args: ['x', 'y'] },
  { name: 'source-anchored-scalar', content: fmDoc('a: &anc hello\nb: *anc'), op: 'frontmatter', args: ['x', 'y'] },
  { name: 'empty-fence', content: fmDoc(''), op: 'frontmatter', args: ['only', 'field'] },
  { name: 'scalar-fence-replaced', content: fmDoc('just a scalar'), op: 'frontmatter', args: ['k', 'v'] },
  { name: 'null-fence-replaced', content: fmDoc('~'), op: 'frontmatter', args: ['k', 'v'] },
  { name: 'proto-key-dropped', content: fmDoc('title: T'), op: 'frontmatter', args: ['__proto__', 'x'] },
  { name: 'no-frontmatter', content: '# Just markdown\n', op: 'frontmatter', args: ['k', 'v'] },
  { name: 'fence-not-leading', content: '\n---\na: 1\n---\n', op: 'frontmatter', args: ['k', 'v'] },
  { name: 'crlf-fence-canonicalized', content: '---\r\ntitle: T\r\n---\r\nBody.\r\n', op: 'frontmatter', args: ['k', 'v'] },
  { name: 'invalid-fence-yaml', content: fmDoc('a: [unclosed'), op: 'frontmatter', args: ['k', 'v'] },
  { name: 'dup-keys-fence', content: fmDoc('a: 1\na: 2'), op: 'frontmatter', args: ['k', 'v'] },
  { name: 'tab-indent-fence', content: fmDoc('a:\n\tb: 1'), op: 'frontmatter', args: ['k', 'v'] },
  { name: 'nested-map-source', content: fmDoc('meta:\n  owner: me\n  level: 2'), op: 'frontmatter', args: ['k', 'v'] },
  { name: 'unicode-value', content: fmDoc('title: T'), op: 'frontmatter', args: ['note', '🎉 fête'] },
  { name: 'UNSUPPORTED-seq-fence', content: fmDoc('- a\n- b'), op: 'frontmatter', args: ['k', 'v'] },
  { name: 'UNSUPPORTED-longline-multiline', content: fmDoc('title: T'), op: 'frontmatter', args: ['note', `short\n${'word '.repeat(25)}end`] },
  { name: 'UNSUPPORTED-int-key', content: fmDoc('title: T'), op: 'frontmatter', args: ['7', 'x'] },
  { name: 'UNSUPPORTED-int-key-in-source', content: fmDoc('0: zero\nz: last'), op: 'frontmatter', args: ['k', 'v'] },
  // -- the YAML reparse guard through add/edit ---------------------------------
  { name: 'guard-add-valid-yaml', path: 'specs/design/components/x/openapi.yaml', content: '', op: 'add', args: ['openapi: 3.0.0\ninfo:\n  title: X\n'] },
  { name: 'guard-add-invalid-yaml', path: 'specs/design/components/x/openapi.yaml', content: '', op: 'add', args: ['openapi: [unclosed\n'] },
  { name: 'guard-add-dup-keys', path: 'x.yaml', content: '', op: 'add', args: ['a: 1\na: 2\n'] },
  { name: 'guard-add-multidoc', path: 'x.yaml', content: '', op: 'add', args: ['a: 1\n---\nb: 2\n'] },
  { name: 'guard-add-tab-indent', path: 'x.yaml', content: '', op: 'add', args: ['a:\n\tb: 1\n'] },
  { name: 'guard-edit-breaks-fence', path: 'doc.md', content: fmDoc('title: T'), op: 'edit', args: ['title: T', 'title: [broken'] },
  { name: 'guard-edit-valid-fence', path: 'doc.md', content: fmDoc('title: T'), op: 'edit', args: ['title: T', 'title: Updated'] },
  { name: 'guard-md-body-not-yaml-checked', path: 'doc.md', content: '# no fence\n', op: 'edit', args: ['no fence', 'not yaml: [unclosed here'] },
];

// -- the component design.json gate (checkComponentDesign ⇄ designspec parity) --
const designPath = 'specs/design/components/api-service/design.json';
const validDesign = {
  name: 'api-service', type: 'service', version: '1.0', language: 'go',
  buildpack: 'go', appPath: '.', entrypoint: 'main.go', exposure: 'internet',
  connections: [{ to: 'db', type: 'datastore', onPlatform: true }],
  description: 'The API.',
};
const dj = (mutate) => {
  const d = structuredClone(validDesign);
  mutate(d);
  return JSON.stringify(d, null, 2);
};
cases.push(
  { name: 'gate-design-valid', path: designPath, content: '', op: 'add', args: [dj(() => {})] },
  { name: 'gate-design-invalid-json', path: designPath, content: '', op: 'add', args: ['{ not json'] },
  { name: 'gate-design-missing-field', path: designPath, content: '', op: 'add', args: [dj((d) => delete d.entrypoint)] },
  { name: 'gate-design-unknown-field', path: designPath, content: '', op: 'add', args: [dj((d) => { d.extra = 'x'; })] },
  { name: 'gate-design-empty-field', path: designPath, content: '', op: 'add', args: [dj((d) => { d.language = ''; })] },
  { name: 'gate-design-bad-enum', path: designPath, content: '', op: 'add', args: [dj((d) => { d.exposure = 'public'; })] },
  { name: 'gate-design-bad-connection', path: designPath, content: '', op: 'add', args: [dj((d) => { d.connections[0].type = 'grpc'; })] },
  { name: 'gate-design-conn-extra-field', path: designPath, content: '', op: 'add', args: [dj((d) => { d.connections[0].via = 'x'; })] },
  { name: 'gate-design-name-mismatch', path: designPath, content: '', op: 'add', args: [dj((d) => { d.name = 'other-name'; })] },
  { name: 'gate-design-root-array', path: designPath, content: '', op: 'add', args: ['[1,2]'] },
  { name: 'gate-design-non-component-path', path: 'specs/design/design.json', content: '', op: 'add', args: ['{ "free": "form" }'] },
);

const results = [];
for (const c of cases) {
  const path = c.path ?? 'specs/requirements/requirements.md';
  const seed = c.op === 'add' ? {} : { [path]: c.content };
  const bundle = new FileBundle(seed);
  let result;
  switch (c.op) {
    case 'frontmatter':
      result = bundle.setFrontmatterField(path, ...c.args);
      break;
    case 'add':
      result = bundle.addFile(path, ...c.args);
      break;
    case 'edit':
      result = bundle.editFile(path, ...c.args);
      break;
    default:
      throw new Error(`bad op ${c.op}`);
  }
  results.push({
    name: c.name,
    path,
    op: c.op,
    content: c.op === 'add' ? null : c.content,
    args: c.args,
    result,
    after: bundle.read(path) ?? null,
  });
}

const target = join(here, '..', 'frontmatter_bundle.json');
writeFileSync(target, `${JSON.stringify(results, null, 1)}\n`);
console.log(`wrote ${results.length} cases to ${target}`);
