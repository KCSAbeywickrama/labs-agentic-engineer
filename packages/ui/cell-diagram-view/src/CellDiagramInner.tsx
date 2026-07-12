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

// Lazy-loaded leaf: keeps the renderer's heavy transitive deps (@xyflow,
// dagre) and its stylesheet out of the main bundle until the diagram is
// actually shown. The component self-imports its CSS, so no separate
// stylesheet import is needed here. `tolerant` lets a still-growing
// `design.cell` render its partial diagram instead of the error placeholder.
import { CellDiagram } from "@aep/ui-cell-diagram-react";

export default function CellDiagramInner({ source }: { source: string }) {
  return <CellDiagram source={source} tolerant style={{ width: "100%", height: "100%" }} />;
}
