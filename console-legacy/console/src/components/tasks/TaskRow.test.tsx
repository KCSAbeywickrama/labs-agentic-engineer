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

// Held-task gate caption, re-pointed onto our GitHub-native derived read model
// (dependency-management Phase 7). Upstream drove this off DB task-graph gate
// columns (dependsOnResources/ExternalResources/OrgServices); we drive it off
// the single derived `dependsOn` list a planned coding issue carries in its
// machine block. depsGate (Phase 6) holds a coding task until each of those —
// component siblings AND external / platform-resource provision gates — resolves
// deployed; the row shows the flat blocking list and the user resolves each in
// the architecture DependencyDrawer (where the provisioning CTAs live now).

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import type { TaskView } from '../../services/api';
import { TASK_SECTIONS, type SectionConfig } from './types';
import { TaskRow } from './TaskRow';

const section = (key: SectionConfig['key']): SectionConfig =>
  TASK_SECTIONS.find((s) => s.key === key)!;

function makeTask(overrides: Partial<TaskView>): TaskView {
  return {
    issueNumber: 1,
    title: 'A task',
    issueUrl: '',
    dependsOn: [],
    lineage: {},
    derivedStatus: 'pending',
    hold: false,
    attention: [],
    executions: {},
    ...overrides,
  };
}

function renderRow(task: TaskView, sec: SectionConfig = section('onHold')) {
  return render(
    <MemoryRouter>
      <TaskRow
        task={task}
        section={sec}
        orgId="org1"
        projectId="proj1"
        onChanged={() => {}}
        index={0}
      />
    </MemoryRouter>,
  );
}

describe('TaskRow — held-task gate caption', () => {
  it('lists the blocking dependencies for an on_hold task', () => {
    const task = makeTask({
      derivedStatus: 'on_hold',
      hold: true,
      dependsOn: ['auth-service', 'orders-db', 'stripe'],
    });

    renderRow(task);

    expect(
      screen.getByText('Waiting for: auth-service, orders-db, stripe'),
    ).toBeInTheDocument();
  });

  it('shows the caption for a pending task with unmet dependencies', () => {
    const task = makeTask({ derivedStatus: 'pending', dependsOn: ['auth-service'] });

    renderRow(task, section('pending'));

    expect(screen.getByText('Waiting for: auth-service')).toBeInTheDocument();
  });

  it('shows no "Waiting for" line for a held task with no recorded deps', () => {
    const task = makeTask({ derivedStatus: 'on_hold', hold: true, dependsOn: [] });

    renderRow(task);

    expect(screen.queryByText(/Waiting for:/)).not.toBeInTheDocument();
  });

  it('shows no "Waiting for" line once the task is in flight', () => {
    const task = makeTask({ derivedStatus: 'in_progress', dependsOn: ['auth-service'] });

    renderRow(task, section('active'));

    expect(screen.queryByText(/Waiting for:/)).not.toBeInTheDocument();
  });
});
