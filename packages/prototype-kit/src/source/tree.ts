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

/** Shared syntax-tree helpers for the static checks (acorn over the analysis transpile). */

import { parse, type Node } from "acorn";
import { SOURCE_FILE, type Finding, type FindingCode } from "../findings.js";
import { transpileForAnalysis } from "./transpile.js";

export type SourceTree = Node;

/** The module's tree; throws (with a `loc`) when the source does not parse. */
export function parseSourceTree(source: string): SourceTree {
  return parse(transpileForAnalysis(source), { ecmaVersion: "latest", sourceType: "module", locations: true });
}

export function lineOf(node: Node): number {
  return (node as Node & { loc: { start: { line: number } } }).loc.start.line;
}

export function sourceFinding(code: FindingCode, node: Node, message: string): Finding {
  return { code, file: SOURCE_FILE, location: `line ${lineOf(node)}`, message };
}

/** Findings sorted by their line, stable within a line. */
export function byLine(findings: Finding[]): Finding[] {
  const line = (f: Finding) => Number(/^line (\d+)$/.exec(f.location)?.[1] ?? 0);
  return [...findings].sort((a, b) => line(a) - line(b));
}

export interface IdentifierNode extends Node {
  name: string;
}

export interface LiteralNode extends Node {
  value: unknown;
}

export function isIdentifier(node: Node | null | undefined, name?: string): node is IdentifierNode {
  return node?.type === "Identifier" && (name === undefined || (node as IdentifierNode).name === name);
}

export function stringLiteral(node: Node | null | undefined): string | undefined {
  if (node?.type !== "Literal") return undefined;
  const value = (node as LiteralNode).value;
  return typeof value === "string" ? value : undefined;
}
