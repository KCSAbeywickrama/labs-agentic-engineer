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

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Task } from '../../services/api';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

import { TaskDetailPanel } from './TaskDetailPanel';

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 't1',
    title: 'A task',
    url: '',
    ...overrides,
  };
}

describe('TaskDetailPanel — SYSTEM task drawer CTAs', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('shows "Provision resource" for a pending resource-provisioning task and deep-links the drawer', () => {
    const task = makeTask({
      type: 'resource-provisioning',
      resourceName: 'orders-db',
      status: 'pending',
      componentTaskId: 'ct1',
    });

    render(<TaskDetailPanel task={task} orgId="org1" projectId="proj1" onClose={vi.fn()} />);

    const cta = screen.getByRole('button', { name: /provision resource/i });
    fireEvent.click(cta);

    expect(mockNavigate).toHaveBeenCalledWith(
      '/organizations/org1/projects/proj1/architecture?dep=orders-db',
    );
  });

  it('shows "Provide configuration" for a config-collection task using externalResourceName', () => {
    const task = makeTask({
      type: 'config-collection',
      externalResourceName: 'exchangerate',
      status: 'on_hold',
      componentTaskId: 'ct2',
    });

    render(<TaskDetailPanel task={task} orgId="org1" projectId="proj1" onClose={vi.fn()} />);

    const cta = screen.getByRole('button', { name: /provide configuration/i });
    fireEvent.click(cta);

    expect(mockNavigate).toHaveBeenCalledWith(
      '/organizations/org1/projects/proj1/architecture?dep=exchangerate',
    );
  });

  it('shows no drawer CTA for a plain component task', () => {
    const task = makeTask({
      type: 'component',
      execType: 'WORKER',
      status: 'pending',
      componentTaskId: 'ct3',
    });

    render(<TaskDetailPanel task={task} orgId="org1" projectId="proj1" onClose={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /provision resource/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /provide configuration/i })).not.toBeInTheDocument();
  });

  it('hides the CTA once the resource-provisioning task reaches a terminal deployed state', () => {
    const task = makeTask({
      type: 'resource-provisioning',
      resourceName: 'orders-db',
      status: 'deployed',
      componentTaskId: 'ct1',
    });

    render(<TaskDetailPanel task={task} orgId="org1" projectId="proj1" onClose={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /provision resource/i })).not.toBeInTheDocument();
  });

  it('excludes Retry for a failed resource-provisioning task — recovery is via the drawer CTA, not coding-agent retry', () => {
    const task = makeTask({
      type: 'resource-provisioning',
      resourceName: 'orders-db',
      status: 'failed',
      componentTaskId: 'ct1',
    });

    render(<TaskDetailPanel task={task} orgId="org1" projectId="proj1" onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: /provision resource/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^retry$/i })).not.toBeInTheDocument();
  });

  it('shows Retry for a failed component task (no drawer dependency)', () => {
    const task = makeTask({
      type: 'component',
      execType: 'WORKER',
      status: 'failed',
      componentTaskId: 'ct3',
    });

    render(<TaskDetailPanel task={task} orgId="org1" projectId="proj1" onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: /^retry$/i })).toBeInTheDocument();
  });
});
