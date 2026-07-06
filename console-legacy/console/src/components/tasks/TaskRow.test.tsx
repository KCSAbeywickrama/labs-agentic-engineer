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

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import type { Task } from '../../services/api';
import type { SectionConfig } from './types';
import { TaskRow } from './TaskRow';

const onHoldSection: SectionConfig = {
  key: 'onHold',
  label: 'On Hold',
  isPrimary: false,
  dotColor: '#f59e0b',
  borderColor: '#f59e0b',
};

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 't1',
    title: 'A task',
    url: '',
    ...overrides,
  };
}

function renderRow(task: Task, section: SectionConfig = onHoldSection) {
  return render(
    <MemoryRouter>
      <TaskRow task={task} section={section} orgId="org1" projectId="proj1" index={0} />
    </MemoryRouter>,
  );
}

describe('TaskRow — on-hold "Waiting for" reasons', () => {
  it('lists every gate kind with an action hint for resource / external-resource / org-service gates', () => {
    const task = makeTask({
      status: 'on_hold',
      dependsOnComponents: ['auth-service'],
      dependsOnResources: ['orders-db'],
      dependsOnExternalResources: ['exchangerate'],
      dependsOnOrgServices: ['billing'],
    });

    renderRow(task);

    expect(
      screen.getByText(
        'Waiting for: auth-service, orders-db (needs provisioning), exchangerate (needs configuration), billing (org-service)',
      ),
    ).toBeInTheDocument();
  });

  it('shows no "Waiting for" line when the task is not on_hold', () => {
    const task = makeTask({
      status: 'pending',
      dependsOnComponents: ['auth-service'],
    });

    renderRow(task);

    expect(screen.queryByText(/Waiting for:/)).not.toBeInTheDocument();
  });

  it('shows no "Waiting for" line for an on_hold task with no recorded gates', () => {
    const task = makeTask({ status: 'on_hold' });

    renderRow(task);

    expect(screen.queryByText(/Waiting for:/)).not.toBeInTheDocument();
  });
});
