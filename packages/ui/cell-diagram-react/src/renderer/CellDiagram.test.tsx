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

import { render, screen } from "@testing-library/react";
import { CellDiagram } from "./CellDiagram";

describe("CellDiagram", () => {
  it("renders a component node from DSL source", () => {
    render(<CellDiagram source={"component api service\nnorth -> api"} />);
    expect(screen.getByText("api")).toBeInTheDocument();
  });

  it("reports diagnostics for invalid source and renders the empty state", () => {
    const onDiagnostics = vi.fn();
    render(<CellDiagram source={"api -> north"} onDiagnostics={onDiagnostics} />);
    expect(onDiagnostics).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ severity: "error" })])
    );
    expect(screen.getByText(/Fix the DSL errors/i)).toBeInTheDocument();
  });

  it("renders a directly-provided model without a source", () => {
    render(<CellDiagram model={{ cells: [{ id: "c", components: [{ id: "api" }], externals: [], edges: [] }], crossEdges: [], sharedExternals: [] }} />);
    expect(screen.getByText("api")).toBeInTheDocument();
  });

  it("renders a partial diagram from an incomplete source in tolerant mode", () => {
    render(<CellDiagram tolerant source={"cell orders {\n  component api"} />);
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.queryByText(/Fix the DSL errors/i)).not.toBeInTheDocument();
  });
});
