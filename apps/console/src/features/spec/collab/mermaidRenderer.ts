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

// The mermaid rendering engine, kept apart from the node view that draws it:
// this half is pure async plumbing and stays testable without a DOM editor.
//
// Mermaid is loaded lazily on the first diagram, so documents without one pay
// nothing for the (large) library.

/** Injectable renderer — the test seam. */
type RenderFn = (id: string, source: string) => Promise<{ svg: string }>;

let renderImpl: RenderFn | null = null;

/** @knipkeep test seam — unit tests inject a fake renderer (jsdom cannot run
 *  real mermaid, which measures rendered SVG text). */
export function setMermaidRenderer(fn: RenderFn | null): void {
  renderImpl = fn;
}

async function load(): Promise<RenderFn> {
  if (!renderImpl) {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "neutral",
      // Without this, a failed parse LEAKS into the page. `render()` is called
      // with no container, so mermaid builds its scratch element under
      // <body>; on a parse error it draws its "Syntax error in text" bomb
      // there, throws, and skips the cleanup that only runs on the success
      // return. The bomb is outside React's tree, so nothing ever removes it —
      // it sits below the app and survives navigation, one per failure.
      //
      // Failures are ROUTINE here, which is what makes the leak visible: the
      // node view re-renders on every keystroke of the agent's stream, so a
      // half-written diagram is parsed (and fails) many times before the block
      // is complete. Suppressed, mermaid cleans up and rethrows instead, and
      // the node view shows its own inline error until the source parses.
      suppressErrorRendering: true,
    });
    renderImpl = (renderID, src) => mermaid.render(renderID, src);
  }
  return renderImpl;
}

let renderSeq = 0;

// Mermaid carries global state across a render, so concurrent render() calls
// deadlock — none of them ever settle, which is what a multi-diagram design
// document triggers when every node view mounts at once. Every render goes
// through this queue and runs strictly one at a time. A rejection must not
// break the chain, hence the swallow on the tail; the caller still sees its
// own rejection through the returned promise.
let queue: Promise<unknown> = Promise.resolve();

/** Render `source` to SVG markup. Calls are serialized process-wide. */
export function renderMermaid(source: string): Promise<string> {
  renderSeq += 1;
  const id = `spec-mermaid-${renderSeq}`;
  const run = queue.then(async () => {
    const render = await load();
    const { svg } = await render(id, source);
    return svg;
  });
  queue = run.catch(() => undefined);
  return run;
}
