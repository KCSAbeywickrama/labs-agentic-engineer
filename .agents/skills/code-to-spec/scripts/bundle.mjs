#!/usr/bin/env node
// Packs a code-to-spec output directory as an `.aespecs` bundle, the archive
// the platform seeds a project from (references/bundle-format.md). No
// dependencies: a store-only zip, entries sorted, fixed timestamps, so the
// same tree gives the same bytes. Only the paths the format allows are
// packed; anything else under specs/ is refused rather than silently skipped,
// so a stray file is noticed here and not at upload.
//
//   node scripts/bundle.mjs <out dir> --product "<name>" --repository "<remote url|local checkout>" --commit <sha> [--version <skill version>]
//
// Writes <out dir>/<product-slug>.aespecs and prints its path.

import { crc32 } from "node:zlib";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const FORMAT = "aespecs/1";
const PRODUCER = "code-to-spec";
const DEPENDENCY_FILES = new Set([
  "dependency.json", "assumptions.md",
  "openapi.yaml", "openapi.yml", "openapi.json",
  "schema.graphql", "schema.graphqls", "sdk.json",
]);
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_BUNDLE_BYTES = 5 << 20;

function usage(message) {
  if (message) console.error(message);
  console.error('usage: bundle.mjs <out dir> --product "<name>" --repository "<remote url|local checkout>" --commit <sha> [--version <skill version>]');
  process.exit(2);
}

function parseArgs(argv) {
  const [dir, ...rest] = argv;
  if (!dir) usage();
  const opts = { version: "1.0" };
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]?.replace(/^--/, "");
    const value = rest[i + 1];
    if (!key || value === undefined) usage(`missing value for --${key ?? "?"}`);
    opts[key] = value;
  }
  for (const key of ["product", "repository", "commit"]) {
    if (!opts[key]) usage(`--${key} is required`);
  }
  if (!/^[0-9a-f]{7,40}$/.test(opts.commit)) usage("--commit is 7 to 40 hex characters");
  if (opts.repository !== "local checkout" && !/^(https:\/\/|git@)\S{1,300}$/.test(opts.repository)) {
    usage('--repository is a remote URL or "local checkout"');
  }
  return { dir: resolve(dir), ...opts };
}

/** Whether a repo-relative path (forward slashes) is one the format allows, with the rule for a refusal. */
function admitted(p) {
  if (p.startsWith("specs/requirements/references/")) return "reference documents are turn inputs, never spec files";
  if (p.startsWith("specs/requirements/")) return p.endsWith(".md") ? null : "a requirements file is markdown";
  if (p === "specs/design/domain-model.md") return null;
  if (p.startsWith("specs/design/dependencies/")) {
    const [dir, file, ...more] = p.slice("specs/design/dependencies/".length).split("/");
    if (!file || more.length) return "a dependency file sits directly in its definition's directory";
    if (!KEBAB.test(dir)) return "a dependency directory is kebab-case";
    if (!DEPENDENCY_FILES.has(file)) return "not a dependency definition, assumptions or contract file";
    return null;
  }
  return "outside the spec tree the format allows";
}

/** Every file under specs/, repo-relative with forward slashes, sorted. */
function walk(root) {
  const out = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue; // the output's own dot-led notes never ship
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`${full}: symbolic links are not packed`);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) out.push(relative(root, full).split(sep).join("/"));
    }
  };
  visit(join(root, "specs"));
  return out.sort();
}

// --- a store-only zip writer ---------------------------------------------

const DOS_TIME = 0x0000; // 00:00:00
const DOS_DATE = (2026 - 1980) << 9 | (1 << 5) | 1; // 2026-01-01: fixed, so bytes never change with the clock

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }

function zipStore(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(DOS_TIME), u16(DOS_DATE),
      u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes, data,
    ]);
    centrals.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(DOS_TIME), u16(DOS_DATE),
      u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
      u32(0x81a40000), u32(offset), nameBytes,
    ]));
    locals.push(local);
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(central.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...locals, central, end]);
}

// --- main -----------------------------------------------------------------

export function bundle({ dir, product, repository, commit, version, now = new Date() }) {
  if (!existsSync(join(dir, "specs"))) throw new Error(`${dir} has no specs/ directory`);
  const paths = walk(dir);
  const refused = paths.map((p) => [p, admitted(p)]).filter(([, rule]) => rule);
  if (refused.length) {
    throw new Error("not packable:\n" + refused.map(([p, rule]) => `  ${p}: ${rule}`).join("\n"));
  }
  if (!paths.includes("specs/requirements/prd.md")) throw new Error("specs/requirements/prd.md is missing");
  const manifest = {
    format: FORMAT,
    producer: { name: PRODUCER, version },
    product,
    source: { repository, commit },
    createdAt: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
  const entries = [
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8") },
    ...paths.map((p) => {
      const data = readFileSync(join(dir, ...p.split("/")));
      if (data.includes(0)) throw new Error(`${p}: not a text file`);
      return { name: p, data };
    }),
  ];
  const bytes = zipStore(entries);
  if (bytes.length > MAX_BUNDLE_BYTES) throw new Error(`the bundle is ${bytes.length} bytes, over the 5 MiB the platform accepts`);
  const slug = product.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "specs";
  const out = join(dir, `${slug}.aespecs`);
  writeFileSync(out, bytes);
  return { path: out, entries: entries.length, bytes: bytes.length };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  try {
    const { path, entries, bytes } = bundle(opts);
    process.stdout.write(`${path} (${entries} entries, ${bytes} bytes)\n`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
