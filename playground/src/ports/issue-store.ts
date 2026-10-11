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
 * `FsIssueStore` — issues as files. `issues/<n>.md` is a GitHub issue on disk:
 * frontmatter (`issueNumber`, `title`, and `version`, the milestone a build
 * issue belongs to) and the body. A Plan turn writes ONE build issue per
 * version, whose body is the plan service's own render (`cmd/build-plan
 * issue`); a person may write a bug issue by hand in the same shape.
 *
 * There is no status field. The coding run ticks a build issue's checklist
 * item when the item's work is done (the local `aep` overlay), so an item's
 * tick is the playground's "closed": the one record a later run resumes from.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

/** One checklist item of a build issue: its ID and whether its tick is set. */
export interface ChecklistItem {
  item: string;
  done: boolean;
}

export interface Issue {
  issueNumber: number;
  title: string;
  /** The version a build issue was planned for; absent on a hand-written issue. */
  version?: string;
  body: string;
  /** The checklist items, in order (a build issue's `- [ ] **<item>** …` lines). */
  items: ChecklistItem[];
  /** Repo-relative file, e.g. `issues/3.md`. */
  file: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
/** The Go `uncheckedItemRE` (taskplan/build_issue.go) widened to ticked lines: one line, no `*` in the item. */
const ITEM_RE = /^- \[( |x|X)\] \*\*([^*\n]+)\*\*/gm;

/** A YAML double-quoted scalar on one line: newlines flatten to spaces; backslash and quote escaped. */
function yamlQuote(s: string): string {
  const flat = s.replaceAll("\r\n", " ").replaceAll("\n", " ");
  return `"${flat.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** The file of an issue: frontmatter, a blank line, then the body as given. */
export function renderIssueFile(issue: { issueNumber: number; title: string; version?: string; body: string }): string {
  let out = `---\nissueNumber: ${issue.issueNumber}\ntitle: ${yamlQuote(issue.title)}\n`;
  if (issue.version) out += `version: ${yamlQuote(issue.version)}\n`;
  return `${out}---\n\n${issue.body}`;
}

/** Parse one issue file, or null when its frontmatter is unusable (never thrown: a bad file is not addressable). */
export function parseIssueFile(file: string, numberFromName: number, content: string): Issue | null {
  const text = content.replaceAll("\r\n", "\n");
  const fence = FRONTMATTER_RE.exec(text);
  if (!fence) return null;
  let fm: Record<string, unknown>;
  try {
    const parsed: unknown = parseYaml(fence[1]!);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    fm = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof fm.title !== "string" || fm.title.trim() === "") return null;
  const issueNumber = typeof fm.issueNumber === "number" && Number.isInteger(fm.issueNumber) ? fm.issueNumber : numberFromName;
  const body = text.slice(fence[0].length).replace(/^\n/, "");
  const items = [...body.matchAll(ITEM_RE)].map((m) => ({ item: m[2]!.trim(), done: m[1] !== " " }));
  return {
    issueNumber,
    title: fm.title,
    ...(typeof fm.version === "string" && fm.version !== "" ? { version: fm.version } : {}),
    body,
    items,
    file,
  };
}

/** True when an issue's checklist is all ticked. An issue with no checklist is never done by this measure. */
export function checklistDone(issue: Issue): boolean {
  return issue.items.length > 0 && issue.items.every((i) => i.done);
}

export class FsIssueStore {
  private readonly dir: string;

  constructor(projectDir: string) {
    this.dir = join(projectDir, "issues");
  }

  /** Every parseable `issues/<n>.md`, sorted by number. */
  list(): Issue[] {
    if (!existsSync(this.dir)) return [];
    const out: Issue[] = [];
    for (const e of readdirSync(this.dir, { withFileTypes: true })) {
      const m = /^(\d+)\.md$/.exec(e.name);
      if (!e.isFile() || !m) continue;
      const parsed = parseIssueFile(`issues/${e.name}`, Number(m[1]), readFileSync(join(this.dir, e.name), "utf8"));
      if (parsed) out.push(parsed);
    }
    return out.sort((a, b) => a.issueNumber - b.issueNumber);
  }

  /** The build issues of earlier versions with work left: a new version is planned only once they are done. */
  unfinishedBuilds(): Issue[] {
    return this.list().filter((i) => i.version !== undefined && !checklistDone(i));
  }

  /** Write a version's build issue under the next free number. */
  writeBuildIssue(issue: { title: string; version: string; body: string }, allocate: () => number): Issue {
    const issueNumber = allocate();
    mkdirSync(this.dir, { recursive: true });
    const file = `issues/${issueNumber}.md`;
    const content = renderIssueFile({ issueNumber, ...issue });
    writeFileSync(join(this.dir, `${issueNumber}.md`), content, "utf8");
    return parseIssueFile(file, issueNumber, content)!;
  }

  /**
   * Wrap a raw counter allocator so it never hands out a number whose file
   * already exists — a project dir copied WITHOUT its `.aep-playground/`
   * state starts the counter at 1 while `issues/1.md` may exist; clobbering
   * an issue is never acceptable. Advances the caller's counter past the
   * allocated number via `commit`.
   */
  safeAllocator(next: () => number, commit: (advancedTo: number) => void): () => number {
    return () => {
      let n = next();
      while (existsSync(join(this.dir, `${n}.md`))) n += 1;
      commit(n + 1);
      return n;
    };
  }
}
