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

import { describe, it, expect } from 'vitest';
import { buildProjectModel, type CellDiagramComponent } from '@aep/cell-diagram-view';

// Regression coverage for the platform-resource cell-diagram node: a
// provisioned db/cache/queue dependency must render as a chain-link external
// node, same as an `external` API or `org-service` dependency — it must
// never be dropped (pre-fix) nor mistaken for an in-cell sibling edge.
describe('buildProjectModel — platform-resource dependency', () => {
  it('renders a platform-resource dependency as a chain-link external connection', () => {
    const components: CellDiagramComponent[] = [
      {
        name: 'orders-service',
        componentType: 'service',
        language: 'go',
        dependencies: [{ kind: 'platform-resource', name: 'orders-db' }],
      },
    ];

    const project = buildProjectModel(components);
    const comp = project.components.find((c) => c.id === 'orders-service');

    expect(comp).toBeDefined();
    expect(comp!.connections).toHaveLength(1);
    expect(comp!.connections[0]).toMatchObject({
      id: 'default:external-apis:orders-db',
      label: 'orders-db',
    });
  });

  it('does not treat a platform-resource dependency as an in-cell sibling edge', () => {
    const components: CellDiagramComponent[] = [
      {
        name: 'orders-service',
        componentType: 'service',
        dependencies: [{ kind: 'platform-resource', name: 'orders-db' }],
      },
    ];

    const project = buildProjectModel(components);
    const comp = project.components.find((c) => c.id === 'orders-service')!;

    // A platform-resource dep is never an `onPlatform` (sibling-component)
    // connection — only `component`-kind dependencies produce those.
    expect(comp.connections.every((c) => !c.onPlatform)).toBe(true);
  });

  it('renders component + platform-resource + external deps side by side', () => {
    const components: CellDiagramComponent[] = [
      {
        name: 'orders-service',
        componentType: 'service',
        dependencies: [
          { kind: 'component', name: 'billing-service' },
          { kind: 'platform-resource', name: 'orders-db' },
          { kind: 'external', name: 'shipping-api' },
        ],
      },
      {
        name: 'billing-service',
        componentType: 'service',
        dependencies: [],
      },
    ];

    const project = buildProjectModel(components);
    const comp = project.components.find((c) => c.id === 'orders-service')!;

    expect(comp.connections).toHaveLength(3);
    expect(comp.connections.find((c) => c.label === 'billing-service')?.onPlatform).toBe(true);
    expect(comp.connections.find((c) => c.label === 'orders-db')?.id).toBe(
      'default:external-apis:orders-db',
    );
    expect(comp.connections.find((c) => c.label === 'shipping-api')?.id).toBe(
      'default:external-apis:shipping-api',
    );
  });
});
