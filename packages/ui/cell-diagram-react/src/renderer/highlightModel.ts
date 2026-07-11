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

interface HighlightableEdge {
  id: string;
  data?: Record<string, unknown> | null;
}

export function edgeConnectionId(edge: HighlightableEdge) {
  return String(edge.data?.connectionId ?? edge.id);
}

export function connectionIdsForNode(edges: HighlightableEdge[], nodeId: string) {
  return Array.from(
    new Set(
      edges
        .filter((edge) => {
          const connectedNodeIds = edge.data?.connectedNodeIds;
          return Array.isArray(connectedNodeIds) && connectedNodeIds.map(String).includes(nodeId);
        })
        .map(edgeConnectionId)
    )
  );
}

export function highlightedNodeIdsForConnections(edges: HighlightableEdge[], connectionIds: Set<string>) {
  return edges.reduce<Set<string>>((nodeIds, edge) => {
    const connectedNodeIds = edge.data?.connectedNodeIds;

    if (connectionIds.has(edgeConnectionId(edge)) && Array.isArray(connectedNodeIds)) {
      connectedNodeIds.forEach((nodeId) => nodeIds.add(String(nodeId)));
    }

    return nodeIds;
  }, new Set<string>());
}
