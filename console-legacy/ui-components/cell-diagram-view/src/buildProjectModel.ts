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

import type { Component, ComponentType, Connection, Project } from '@wso2/cell-diagram';

/**
 * One entry of the console's unified, kind-discriminated `Dependency` (see
 * the API type / the BFF's `models.Dependency`). Only `kind` + `name` are
 * needed to place a diagram edge — this is intentionally the minimal shape;
 * a later task adds dedicated `platform-resource` nodes and can widen it
 * then.
 */
export interface CellDiagramDependency {
  kind: string;
  name: string;
}

/**
 * Structural shape consumed by {@link buildProjectModel}. Any object with these
 * fields (e.g. the console's `DesignComponent` API type) is acceptable.
 */
export interface CellDiagramComponent {
  name: string;
  componentType: string;
  language?: string;
  dependencies?: CellDiagramDependency[];
}

const TYPE_MAP: Record<string, ComponentType> = {
  'web-app': 'web-app' as ComponentType,
  service: 'service' as ComponentType,
};

const PROJECT_ID = 'project';
// Synthetic "project" segment used in the external-dependency connection id.
// The cell-diagram lib treats any Connection whose id's project segment
// differs from the current project's id as external and lays it out on the
// east bound. Keeping a fixed value here groups all external deps under one
// virtual umbrella in the diagram.
const EXTERNAL_DEP_PROJECT_SEGMENT = 'external-apis';

// In-cell sibling edges: only `component`-kind dependencies point at another
// component within this same project.
function siblingNames(comp: CellDiagramComponent): string[] {
  return (comp.dependencies || []).filter((d) => d.kind === 'component').map((d) => d.name);
}

function externalDependencyConnection(dep: CellDiagramDependency): Connection {
  return {
    id: `default:${EXTERNAL_DEP_PROJECT_SEGMENT}:${dep.name}`,
    label: dep.name,
    tooltip: dep.name,
  };
}

export function buildProjectModel(components: CellDiagramComponent[]): Project {
  const mapped: Component[] = components.map((comp) => {
    const siblings = siblingNames(comp);
    const siblingConnections: Connection[] = siblings.map((depName) => ({
      id: `default:${PROJECT_ID}:${depName}`,
      label: depName,
      onPlatform: true,
    }));
    // External nodes: `external` (HTTP APIs the component calls out to) and
    // `org-service` (another project's published component) dependencies both
    // render as chain-link nodes outside the cell — this is what the legacy
    // `dependentApis` list produced pre-unified-model. `platform-resource` is
    // deliberately excluded here; it gets dedicated diagram nodes in a later
    // task.
    const externalConnections: Connection[] = (comp.dependencies || [])
      .filter((d) => d.kind === 'external' || d.kind === 'org-service')
      .map(externalDependencyConnection);

    return {
      id: comp.name,
      label: comp.name,
      version: '1.0.0',
      type: TYPE_MAP[comp.componentType] ?? ('service' as ComponentType),
      buildPack: comp.language,
      services:
        comp.componentType === 'web-app'
          ? {
              [`${comp.name}:web`]: {
                id: `${comp.name}:web`,
                label: 'WebApp',
                type: 'HTTP',
                dependencyIds: siblings.map((dep) => `${dep}:api`),
                deploymentMetadata: {
                  gateways: { internet: { isExposed: true }, intranet: { isExposed: false } },
                },
              },
            }
          : comp.componentType === 'service'
            ? {
                [`${comp.name}:api`]: {
                  id: `${comp.name}:api`,
                  label: 'API',
                  type: 'HTTP',
                  dependencyIds: siblings.map((dep) => `${dep}:api`),
                  deploymentMetadata: {
                    gateways: { internet: { isExposed: false }, intranet: { isExposed: false } },
                  },
                },
              }
            : {},
      connections: [...siblingConnections, ...externalConnections],
    };
  });

  return {
    id: PROJECT_ID,
    name: 'Architecture',
    modelVersion: '0.2.0',
    components: mapped,
  };
}
