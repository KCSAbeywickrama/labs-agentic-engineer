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
 * `@wso2/prototype-kit/build`: bundles a theme with the kit and React into
 * the self-contained runtime the isolated render check runs
 * (`check-runtime.js`), an IIFE: it runs where no module loader exists.
 * Needs `esbuild` (an optional peer dependency).
 */

import { build, type BuildOptions, type StdinOptions } from "esbuild";
import { join } from "node:path";

export interface BuildThemeRuntimesOptions {
  /** A module specifier (or absolute path) whose default export is the `PrototypeTheme`. */
  theme: string;
  /** Where `theme` and `@wso2/prototype-kit` resolve from: the theme package's root. */
  resolveDir: string;
  /** Where to write the runtimes. */
  outDir: string;
  minify?: boolean | undefined;
}

export interface ThemeRuntimeFiles {
  checkRuntime: string;
}

const COMMON: BuildOptions = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  legalComments: "none",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
};

function entry(lines: string[], resolveDir: string, sourcefile: string): StdinOptions {
  return { contents: lines.join("\n"), resolveDir, loader: "ts", sourcefile };
}

export async function buildThemeRuntimes(options: BuildThemeRuntimesOptions): Promise<ThemeRuntimeFiles> {
  const theme = JSON.stringify(options.theme);
  const files: ThemeRuntimeFiles = { checkRuntime: join(options.outDir, "check-runtime.js") };
  await build({
    ...COMMON,
    minify: options.minify ?? true,
    outfile: files.checkRuntime,
    // The check context has no DOM: resolve packages for a server render.
    conditions: ["worker", "browser"],
    stdin: entry(
      [`import "@wso2/prototype-kit/build/check-prelude";`, `import theme from ${theme};`, `import { startCheck } from "@wso2/prototype-kit/build/check-entry";`, "startCheck(theme);"],
      options.resolveDir,
      "check-runtime-entry.ts",
    ),
  });
  return files;
}
