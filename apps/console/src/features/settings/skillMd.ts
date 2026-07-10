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

// A SKILL.md is YAML frontmatter followed by a markdown body. Markdown has no
// notion of frontmatter: rendering the raw file would turn the opening `---`
// into a thematic break and the closing `---` into a setext heading over the
// last frontmatter line. Split it off before rendering, and show it verbatim.
export function splitFrontmatter(skillMd: string): {
  frontmatter: string | null;
  body: string;
} {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(
    skillMd,
  );
  if (!match) return { frontmatter: null, body: skillMd };
  return { frontmatter: match[1] ?? "", body: skillMd.slice(match[0].length) };
}
