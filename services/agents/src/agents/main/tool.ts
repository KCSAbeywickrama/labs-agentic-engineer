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
 * The four file-mutation tools the main agent calls, built over a FileBundle.
 *
 * PROPERTY ORDER IS LOAD-BEARING. `path` is the first property in every schema
 * so the provider streams it first and the runner can print the file header the
 * instant it resolves; the large string (`content` / `newString`) is last so it
 * streams delta-by-delta. The execute() return value IS what the model reads to
 * decide its next step — all console rendering happens in run.ts off
 * `stream`, never here, so nothing prints twice.
 */

import { tool } from "ai";
import type { Tool } from "ai";
import { z } from "zod";
import { FileBundle } from "./bundle.js";

export const ADD_FILE = "addFile" as const;
export const EDIT_FILE = "editFile" as const;
export const REMOVE_FILE = "removeFile" as const;
export const SET_FRONTMATTER_FIELD = "setFrontmatterField" as const;

export const TOOL_NAMES = [ADD_FILE, EDIT_FILE, REMOVE_FILE, SET_FRONTMATTER_FIELD] as const;

/** Build the tool set bound to one bundle for the duration of a turn. */
export function buildTools(bundle: FileBundle): Record<string, Tool> {
  return {
    [ADD_FILE]: tool({
      description:
        "Create a NEW file. The only tool that emits a whole body — use it for files that do not exist yet, " +
        "or (after removeFile) to replace a file wholesale. Errors with ALREADY_EXISTS if the path is already present.",
      inputSchema: z.object({
        path: z.string().describe('New bundle path, e.g. "specs/design/components/foo/openapi.yaml". Must not already exist.'),
        content: z.string().describe("The full initial file body."),
      }),
      execute: async ({ path, content }) => bundle.addFile(path, content),
    }),

    [EDIT_FILE]: tool({
      description:
        "Change part of an existing file by replacing oldString with newString. oldString must be copied VERBATIM " +
        "from the file (including leading indentation and newlines) and must match EXACTLY ONE location. On NOT_UNIQUE, " +
        "broaden the anchor with surrounding lines; on NOT_FOUND, re-copy the snippet exactly. Use this for prose AND " +
        "openapi.yaml; for frontmatter keys prefer setFrontmatterField.",
      inputSchema: z.object({
        path: z.string().describe("Existing bundle path to edit."),
        oldString: z
          .string()
          .min(1)
          .describe("Verbatim snippet to replace, including its exact leading whitespace. Must occur exactly once."),
        newString: z.string().describe("Replacement text (may be empty to delete the snippet)."),
      }),
      execute: async ({ path, oldString, newString }) => bundle.editFile(path, oldString, newString),
    }),

    [REMOVE_FILE]: tool({
      description:
        "Delete a file. Idempotent (deleting an absent path is a NOOP success). Refuses to delete the structural roots " +
        "(requirements.md, design.md) with PROTECTED_PATH.",
      inputSchema: z.object({
        path: z.string().describe("Existing bundle path to delete."),
      }),
      execute: async ({ path }) => bundle.removeFile(path),
    }),

    [SET_FRONTMATTER_FIELD]: tool({
      description:
        "Set a single YAML frontmatter field on a markdown file (the keys between the leading --- fences, e.g. " +
        "language, buildpack, skillsApplied). Owns the rendering so list/array values never need fragile multi-line " +
        "anchoring. Requires existing frontmatter (NO_FRONTMATTER otherwise).",
      inputSchema: z.object({
        path: z.string().describe("Markdown file with leading --- frontmatter."),
        key: z.string().describe("Frontmatter key to set or add, e.g. 'buildpack' or 'skillsApplied'."),
        value: z
          .union([z.string(), z.number(), z.boolean(), z.array(z.string())])
          .describe("New value. Arrays render as a YAML block list."),
      }),
      execute: async ({ path, key, value }) => bundle.setFrontmatterField(path, key, value),
    }),
  };
}
