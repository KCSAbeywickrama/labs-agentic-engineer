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

import { CellModel, CrossEdge, Diagnostic, ExternalNode, ProjectCompileResult, ProjectModel } from "../domain/cellModel";
import { parseProject, ParsedCrossEdgeResolved } from "../parser/parseProject";
import { compileCellDocument } from "./compileCellSource";

function resolveCrossEdges(
  parsed: ParsedCrossEdgeResolved[],
  cellsById: Map<string, CellModel>
): { edges: CrossEdge[]; diagnostics: Diagnostic[] } {
  const edges: CrossEdge[] = [];
  const diagnostics: Diagnostic[] = [];
  parsed.forEach((edge) => {
    if (!cellsById.has(edge.sourceCell)) {
      diagnostics.push({ severity: "error", message: `Unknown cell "${edge.sourceCell}".`, line: edge.line, column: 1 });
      return;
    }
    if (!cellsById.has(edge.targetCell)) {
      diagnostics.push({ severity: "error", message: `Unknown cell "${edge.targetCell}".`, line: edge.line, column: 1 });
      return;
    }
    edges.push({
      id: edge.id,
      sourceCell: edge.sourceCell,
      sourceComp: edge.sourceComp,
      targetCell: edge.targetCell,
      targetComp: edge.targetComp,
      exit: edge.exit,
      entry: edge.entry,
      mode: edge.mode,
      label: edge.label,
      line: edge.line
    });
  });
  return { edges, diagnostics };
}

export interface CompileProjectOptions {
  /**
   * Best-effort mode: return the constructed model even when diagnostics exist,
   * instead of collapsing to `model: null`. Used for streaming a growing DSL
   * prefix (e.g. a live `design.cell`) where trailing lines are transiently
   * incomplete. Default behavior (any diagnostic => `model: null`) is unchanged.
   */
  tolerant?: boolean;
}

export function compileProject(source: string, options: CompileProjectOptions = {}): ProjectCompileResult {
  const { project, diagnostics: parseDiagnostics } = parseProject(source);
  const diagnostics: Diagnostic[] = [...parseDiagnostics];

  const cells: CellModel[] = project.cells.map((cell) => {
    const compiled = compileCellDocument(cell.document);
    diagnostics.push(...compiled.diagnostics);
    return {
      id: cell.id,
      label: cell.label,
      version: cell.document.version,
      components: compiled.components,
      externals: compiled.externals,
      edges: compiled.edges
    };
  });

  // Group externals by id across all cells; used by >=2 cells => shared.
  // First cell to declare a shared external's id wins for direction/line; label/type are backfilled from any use site that provides them.
  const usage = new Map<string, { cells: Set<string>; node: ExternalNode }>();
  cells.forEach((cell) => {
    cell.externals.forEach((ext) => {
      const entry = usage.get(ext.id) ?? { cells: new Set<string>(), node: ext };
      entry.cells.add(cell.id);
      if (!entry.node.label && ext.label) { entry.node = { ...entry.node, label: ext.label }; }
      if (!entry.node.type && ext.type) { entry.node = { ...entry.node, type: ext.type }; }
      usage.set(ext.id, entry);
    });
  });

  const sharedIds = new Set(Array.from(usage.entries()).filter(([, v]) => v.cells.size >= 2).map(([id]) => id));
  const sharedExternals: ExternalNode[] = Array.from(sharedIds).map((id) => usage.get(id)!.node);
  const scopedCells: CellModel[] = cells.map((cell) => ({
    ...cell,
    externals: cell.externals.filter((ext) => !sharedIds.has(ext.id))
  }));

  const cellsById = new Map(scopedCells.map((cell) => [cell.id, cell]));
  const { edges: crossEdges, diagnostics: crossDiagnostics } = resolveCrossEdges(project.crossEdges, cellsById);
  diagnostics.push(...crossDiagnostics);

  if (diagnostics.length > 0 && !options.tolerant) {
    return { model: null, diagnostics };
  }

  const model: ProjectModel = { title: project.title, cells: scopedCells, crossEdges, sharedExternals };
  return { model, diagnostics };
}
