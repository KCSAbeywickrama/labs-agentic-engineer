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
 * The type stage of the prototype check: `prototype.tsx` type-checked against
 * the kit's declarations and React's, so a name the source reads that its own
 * types do not have — a record field renamed in its interface and not at every
 * use, a kit prop that does not exist — is refused with its line before
 * anything renders. Transpiling erases types, so the earlier stages cannot see
 * these.
 *
 * In-process, with the TypeScript compiler API, over an in-memory program
 * whose one root is the prototype. Nothing is emitted and nothing runs. Every
 * other file (the standard library, React's types, the kit's declarations) is
 * read from the kit's own installation, parsed once per process and reused by
 * every later check, so a warm check pays only for the prototype.
 *
 * Node-only: the compiler is large, so this stage lives behind `/check`,
 * never `/source`, which a browser host's static gate imports.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { SOURCE_FILE, type Finding } from "../findings.js";

/** The most type findings one check reports; the rest come after these are fixed. */
export const MAX_TYPE_FINDINGS = 20;

/** The longest message one finding carries; a deep elaboration is cut after it. */
const MAX_MESSAGE_LENGTH = 600;

const KIT_MODULE = "@wso2/prototype-kit";

/** The modules a prototype's program reads React's types through: its import and the JSX runtime's. */
const REACT_MODULES = ["react", "react/jsx-runtime"];

/**
 * Not strict: the stage refuses names and shapes that do not exist, which no
 * run of the screens can make right. Strict mode's discipline (a possibly
 * undefined lookup, an unannotated parameter) is not a broken prototype, and
 * the render check draws every screen for what a missing value breaks.
 */
const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  // What the kit's declarations are written against.
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  // No ambient @types/* from node_modules: a prototype sees only its imports.
  types: [],
  strict: false,
  skipLibCheck: true,
  noEmit: true,
};

/** What every check shares: where the prototype sits in the program, and every other file, parsed once. */
interface Environment {
  /** The kit's public entry the prototype's import resolves to. */
  kitEntry: ts.ResolvedModuleFull;
  /** A path in the kit's folder, so `react` resolves to the React types the kit is installed with. */
  sourcePath: string;
  files: Map<string, ts.SourceFile>;
  resolutions: ts.ModuleResolutionCache;
}

let environment: Environment | undefined;

function environmentOf(): Environment {
  environment ??= createEnvironment();
  return environment;
}

/**
 * The kit's entry is its declarations when the kit runs built, its sources
 * when it runs from them (the kit's own tests). Throws when the kit or React's
 * types are not installed: that is the host's fault, not the prototype's.
 */
function createEnvironment(): Environment {
  const entry = ["../index.d.ts", "../index.ts"].map((p) => fileURLToPath(new URL(p, import.meta.url))).find((p) => existsSync(p));
  if (entry === undefined) throw new Error(`the prototype type check found no kit entry beside ${fileURLToPath(import.meta.url)}`);
  const kitDir = dirname(dirname(entry));
  const env: Environment = {
    kitEntry: { resolvedFileName: entry, extension: entry.endsWith(".d.ts") ? ts.Extension.Dts : ts.Extension.Ts, isExternalLibraryImport: false },
    sourcePath: join(kitDir, "__prototype__", SOURCE_FILE),
    files: new Map(),
    resolutions: ts.createModuleResolutionCache(kitDir, (f) => f, OPTIONS),
  };
  for (const name of REACT_MODULES) {
    if (!ts.resolveModuleName(name, env.sourcePath, OPTIONS, ts.sys, env.resolutions).resolvedModule) {
      throw new Error(`the prototype type check cannot resolve ${JSON.stringify(name)} from ${kitDir}: install @types/react with @wso2/prototype-kit`);
    }
  }
  return env;
}

function hostFor(env: Environment, source: ts.SourceFile): ts.CompilerHost {
  const host = ts.createCompilerHost(OPTIONS);
  host.getSourceFile = (fileName, languageVersion) => {
    if (fileName === env.sourcePath) return source;
    let file = env.files.get(fileName);
    if (!file) {
      const text = ts.sys.readFile(fileName);
      if (text === undefined) return undefined;
      file = ts.createSourceFile(fileName, text, languageVersion);
      env.files.set(fileName, file);
    }
    return file;
  };
  host.fileExists = (fileName) => fileName === env.sourcePath || ts.sys.fileExists(fileName);
  host.readFile = (fileName) => (fileName === env.sourcePath ? source.text : ts.sys.readFile(fileName));
  host.writeFile = () => {};
  host.resolveModuleNameLiterals = (literals, containingFile, _redirect, options) =>
    literals.map((literal) =>
      containingFile === env.sourcePath && literal.text === KIT_MODULE
        ? { resolvedModule: env.kitEntry }
        : ts.resolveModuleName(literal.text, containingFile, options, host, env.resolutions),
    );
  return host;
}

/**
 * The type errors in a prototype source that passed the static checks, by
 * line, at most `MAX_TYPE_FINDINGS`; empty when it type-checks. The first call
 * in a process reads and parses the declarations (about half a second); later
 * calls reuse them.
 */
export function checkSourceTypes(text: string): Finding[] {
  const env = environmentOf();
  const source = ts.createSourceFile(env.sourcePath, text, ts.ScriptTarget.ES2022, false, ts.ScriptKind.TSX);
  const program = ts.createProgram({ rootNames: [env.sourcePath], options: OPTIONS, host: hostFor(env, source) });
  const syntactic = program.getSyntacticDiagnostics(source);
  const diagnostics = syntactic.length > 0 ? syntactic : program.getSemanticDiagnostics(source);
  return diagnostics
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
    .slice(0, MAX_TYPE_FINDINGS)
    .map((d) => ({
      code: syntactic.length > 0 ? "SYNTAX_ERROR" : "TYPE_ERROR",
      file: SOURCE_FILE,
      location: d.start === undefined ? "(file)" : `line ${source.getLineAndCharacterOfPosition(d.start).line + 1}`,
      message: messageOf(d),
    }));
}

function messageOf(d: ts.Diagnostic): string {
  const text = ts.flattenDiagnosticMessageText(d.messageText, " ").replace(/\s+/g, " ").trim();
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : text;
}
