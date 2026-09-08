#!/usr/bin/env node
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

// The design system's Setup step, run from the App Path once the scaffold's
// package.json exists and BEFORE the first `npm install`:
//
//   node scripts/setup.mjs [app-path] [--charts] [--no-install]
//
// One command, one install. It pins `react` and `react-dom` to exactly the
// version Oxygen's peer dependency names (a newer 19.x fails `npm install`
// with ERESOLVE, and forcing past that ships two Reacts), adds
// `@wso2/oxygen-ui`, `@wso2/oxygen-ui-icons-react` and `react-router` to
// package.json, drops any `@mui/*`, `@emotion/*` or `lucide-react` a scaffold
// slipped in (Oxygen bundles them; a second copy breaks theming at runtime),
// and runs `npm install` once. Written as a manifest edit rather than a
// sequence of installs because each `npm install` is a full resolve: the
// command sequence this replaced ran three of them.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const OXYGEN = "@wso2/oxygen-ui";
const ICONS = "@wso2/oxygen-ui-icons-react";
const CHARTS = "@wso2/oxygen-ui-charts-react";
const ROUTER = "react-router";
const BUNDLED = ["@mui/", "@emotion/", "lucide-react"];

const isBundled = (dep) => BUNDLED.some((p) => (p.endsWith("/") ? dep.startsWith(p) : dep === p));

/** `npm view <spec> <field…> --json`, parsed; throws with npm's stderr on failure. */
function npmView(cwd, spec, fields) {
  const r = spawnSync("npm", ["view", spec, ...fields, "--json"], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`npm view ${spec} failed: ${(r.stderr || r.stdout).trim()}`);
  const value = JSON.parse(r.stdout);
  // One field comes back bare; several come back keyed by field name.
  return fields.length === 1 ? { [fields[0]]: value } : value;
}

// --- just enough semver to read a peer range ------------------------------
//
// react-router's newest release may need a React newer than the exact one
// Oxygen pins (8.3.1 wants >=19.2.7 while Oxygen 0.13.1 pins 19.2.3), and
// npm resolves `react-router@latest` before it discovers that, then fails
// with ERESOLVE. So the router version is chosen HERE: the newest release
// whose React peer range the pinned React satisfies. The ranges peers use
// are simple (`>=18`, `^18.0.0 || ^19.0.0`, `>=19.2.7`), and that is all
// this reads; the skill ships no dependencies, so `semver` is not available.

const parse = (v) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(-[\w.]+)?/.exec(v.trim());
  return m ? { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: Boolean(m[4]) } : null;
};
const compare = (a, b) => a.n[0] - b.n[0] || a.n[1] - b.n[1] || a.n[2] - b.n[2];

/** Whether `version` (exact) satisfies a peer `range`; an unreadable range counts as satisfied. */
function satisfies(version, range) {
  const v = parse(version);
  if (!v || !range || range.trim() === "*" || range.trim() === "") return true;
  const partial = (s) => {
    const p = s.replace(/^[=v]/, "").split(".").map((x) => (x === "x" || x === "*" || x === "" ? null : Number(x)));
    return [p[0] ?? 0, p[1] ?? null, p[2] ?? null];
  };
  const full = ([a, b, c]) => ({ n: [a, b ?? 0, c ?? 0], pre: false });
  const comparator = (c) => {
    const m = /^(>=|<=|>|<|\^|~|=)?\s*(.+)$/.exec(c.trim());
    if (!m) return true;
    const [, op = "", num] = m;
    const p = partial(num);
    const lo = full(p);
    switch (op) {
      case ">=":
        return compare(v, lo) >= 0;
      case ">":
        return compare(v, lo) > 0;
      case "<":
        return compare(v, lo) < 0;
      case "<=":
        return compare(v, lo) <= 0;
      case "^": {
        const hi = p[0] > 0 ? full([p[0] + 1, 0, 0]) : p[1] > 0 ? full([0, p[1] + 1, 0]) : full([0, 0, (p[2] ?? 0) + 1]);
        return compare(v, lo) >= 0 && compare(v, hi) < 0;
      }
      case "~":
        return compare(v, lo) >= 0 && compare(v, full([p[0], (p[1] ?? 0) + 1, 0])) < 0;
      default: // exact, or a partial like `18` / `18.x` meaning that whole range
        if (p[1] === null) return v.n[0] === p[0];
        if (p[2] === null) return v.n[0] === p[0] && v.n[1] === p[1];
        return compare(v, lo) === 0;
    }
  };
  return range.split("||").some((alt) => alt.trim().split(/\s+/).every(comparator));
}

/** The newest non-prerelease `react-router` whose React peer the pinned React satisfies. */
function resolveRouter(appDir, react) {
  const raw = npmView(appDir, `${ROUTER}@>=7.0.0`, ["version", "peerDependencies.react"]);
  const releases = (Array.isArray(raw) ? raw : [raw]).filter((r) => r && typeof r.version === "string");
  const ok = releases
    .filter((r) => !parse(r.version)?.pre && satisfies(react, r["peerDependencies.react"]))
    .sort((a, b) => compare(parse(a.version), parse(b.version)));
  if (ok.length === 0) throw new Error(`no ${ROUTER} release accepts react ${react}; check ${ROUTER}'s peer dependency by hand`);
  return ok[ok.length - 1].version;
}

/**
 * `{ oxygen, icons, router, react }` — versions to write. The peer React
 * version comes from the installed package when there is one (no network),
 * else from the registry.
 */
function resolveVersions(appDir) {
  const installed = path.join(appDir, "node_modules", OXYGEN, "package.json");
  let oxygen;
  let react;
  if (existsSync(installed)) {
    const pkg = JSON.parse(readFileSync(installed, "utf8"));
    oxygen = pkg.version;
    react = pkg.peerDependencies?.react;
  }
  if (!oxygen || !react) {
    const v = npmView(appDir, `${OXYGEN}@latest`, ["version", "peerDependencies.react"]);
    oxygen = v.version;
    react = v["peerDependencies.react"];
  }
  if (!/^\d+\.\d+\.\d+$/.test(react ?? "")) throw new Error(`${OXYGEN} names no exact React peer version (got ${react ?? "nothing"}); pin react by hand`);
  const icons = npmView(appDir, `${ICONS}@latest`, ["version"]).version;
  const router = resolveRouter(appDir, react);
  return { oxygen, icons, router, react };
}

function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const appDir = path.resolve(args.find((a) => !a.startsWith("--")) ?? process.cwd());
  const pkgPath = path.join(appDir, "package.json");
  if (!existsSync(pkgPath)) {
    console.log(`FAIL  no package.json at ${appDir}\n  fix: scaffold per react-webapp first, then run this from the App Path (or pass it as the argument)`);
    process.exit(1);
  }
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (pkg === null || typeof pkg !== "object" || Array.isArray(pkg)) throw new Error("not a JSON object");
  } catch (e) {
    console.log(`FAIL  ${pkgPath} is not valid JSON: ${e.message}`);
    process.exit(1);
  }

  let versions;
  try {
    versions = resolveVersions(appDir);
  } catch (e) {
    console.log(`FAIL  could not resolve versions\n  fix: ${e.message}`);
    process.exit(1);
  }

  pkg.dependencies ??= {};
  const removed = [];
  for (const section of ["dependencies", "devDependencies"]) {
    for (const dep of Object.keys(pkg[section] ?? {})) {
      if (isBundled(dep)) {
        delete pkg[section][dep];
        removed.push(dep);
      }
    }
  }
  const wanted = {
    react: versions.react,
    "react-dom": versions.react,
    [OXYGEN]: `^${versions.oxygen}`,
    [ICONS]: `^${versions.icons}`,
    [ROUTER]: `^${versions.router}`,
    ...(flags.has("--charts") ? { [CHARTS]: `^${versions.oxygen}` } : {}),
  };
  const changed = [];
  for (const [dep, version] of Object.entries(wanted)) {
    if (pkg.dependencies[dep] !== version) {
      changed.push(`${dep}@${version}`);
      pkg.dependencies[dep] = version;
    }
    delete pkg.devDependencies?.[dep];
  }
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  console.log(`ok    react and react-dom pinned to ${versions.react} (Oxygen ${versions.oxygen}'s peer dependency)`);
  console.log(`ok    react-router ${versions.router} — the newest release whose React peer accepts ${versions.react}`);
  console.log(changed.length ? `ok    package.json: ${changed.join(", ")}` : "ok    package.json already carried every dependency at these versions");
  if (removed.length) console.log(`ok    removed ${removed.join(", ")} — Oxygen bundles them; a second copy breaks theming at runtime`);

  if (flags.has("--no-install")) {
    console.log("ok    --no-install: run `npm install` from the App Path to apply");
    return;
  }
  const r = spawnSync("npm", ["install"], { cwd: appDir, stdio: "inherit" });
  if (r.status !== 0) {
    console.log(`FAIL  npm install exited ${r.status}\n  fix: read npm's output above; never --force or --legacy-peer-deps past an ERESOLVE`);
    process.exit(1);
  }
  console.log("oxygen-ui-design-system setup: ok (one npm install)");
}

main();
