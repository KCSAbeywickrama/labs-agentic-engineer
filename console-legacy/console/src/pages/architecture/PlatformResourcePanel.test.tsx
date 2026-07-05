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

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Dependency } from '../../services/api/types';

// Mock the provisioning module before importing the panel
vi.mock('../../services/api/provisioning', () => ({
  provisioningApi: {
    provision: vi.fn(),
    getStatus: vi.fn(),
  },
}));

import * as provisioningModule from '../../services/api/provisioning';
import { PlatformResourcePanel } from './PlatformResourcePanel';

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>
  );
}

const BASE_PROPS = {
  projectId: 'my-project',
  component: 'api-service',
  onChanged: vi.fn(),
};

// -- Dependency fixtures -----------------------------------------------------
// NOTE: the design-time `Dependency` shape never carries `status` for
// platform-resource (aep-api's read-time 4-state resolution only applies to
// org-service) and has no `outputs` field — the status endpoint is the only
// source of truth for both, so every test below mocks `getStatus`.

const depWithParams: Dependency = {
  kind: 'platform-resource',
  name: 'postgres',
  resourceType: 'postgres-cnpg',
  parameters: {
    version: '16',
    storage: '10Gi',
  },
};

const depNoParams: Dependency = {
  kind: 'platform-resource',
  name: 'redis',
  resourceType: 'redis-standalone',
};

// ----------------------------------------------------------------------------

describe('PlatformResourcePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // (a) never provisioned (status: pending) — param form + Provision button,
  //     clicking calls provisioningApi.provision
  // -------------------------------------------------------------------------
  describe('never provisioned (status: pending)', () => {
    beforeEach(() => {
      vi.mocked(provisioningModule.provisioningApi.getStatus).mockResolvedValue({
        status: 'pending',
        ready: false,
        outputs: [],
      });
    });

    it('renders the parameter form with inputs from dep.parameters', async () => {
      render(
        <PlatformResourcePanel {...BASE_PROPS} dep={depWithParams} />,
        { wrapper },
      );

      expect(await screen.findByRole('button', { name: /provision/i })).toBeInTheDocument();
      expect(screen.getByLabelText('version')).toBeInTheDocument();
      expect(screen.getByLabelText('storage')).toBeInTheDocument();
    });

    it('pre-fills param fields with dep.parameters defaults', async () => {
      render(
        <PlatformResourcePanel {...BASE_PROPS} dep={depWithParams} />,
        { wrapper },
      );

      expect(await screen.findByLabelText('version')).toHaveValue('16');
      expect(screen.getByLabelText('storage')).toHaveValue('10Gi');
    });

    it('renders no param fields and shows defaults-note when dep.parameters is empty', async () => {
      render(
        <PlatformResourcePanel {...BASE_PROPS} dep={depNoParams} />,
        { wrapper },
      );

      expect(await screen.findByRole('button', { name: /provision/i })).toBeInTheDocument();
      expect(screen.getByText(/defaults will be used/i)).toBeInTheDocument();
    });

    it('clicking Provision calls provisioningApi.provision with correct args', async () => {
      vi.mocked(provisioningModule.provisioningApi.provision).mockResolvedValue(undefined);
      const onChanged = vi.fn();

      render(
        <PlatformResourcePanel
          {...BASE_PROPS}
          dep={depWithParams}
          onChanged={onChanged}
        />,
        { wrapper },
      );

      // Modify one param
      fireEvent.change(await screen.findByLabelText('version'), {
        target: { value: '15' },
      });

      fireEvent.click(screen.getByRole('button', { name: /provision/i }));

      await waitFor(() => {
        expect(provisioningModule.provisioningApi.provision).toHaveBeenCalledWith(
          'my-project',
          'api-service',
          'postgres',
          {
            params: { version: '15', storage: '10Gi' },
            environments: ['development'],
          },
        );
      });

      expect(onChanged).toHaveBeenCalled();
    });

    it('calls provisioningApi.provision with no params field when dep has no parameters', async () => {
      vi.mocked(provisioningModule.provisioningApi.provision).mockResolvedValue(undefined);
      const onChanged = vi.fn();

      render(
        <PlatformResourcePanel
          {...BASE_PROPS}
          dep={depNoParams}
          onChanged={onChanged}
        />,
        { wrapper },
      );

      fireEvent.click(await screen.findByRole('button', { name: /provision/i }));

      await waitFor(() => {
        expect(provisioningModule.provisioningApi.provision).toHaveBeenCalledWith(
          'my-project',
          'api-service',
          'redis',
          {
            params: undefined,
            environments: ['development'],
          },
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // (b) building status — progress indicator, polling enabled
  // -------------------------------------------------------------------------
  describe('building status', () => {
    beforeEach(() => {
      vi.mocked(provisioningModule.provisioningApi.getStatus).mockResolvedValue({
        status: 'building',
        ready: false,
        outputs: [],
      });
    });

    it('renders progress text once the status query resolves to building', async () => {
      render(
        <PlatformResourcePanel {...BASE_PROPS} dep={depWithParams} />,
        { wrapper },
      );

      await waitFor(() => {
        expect(screen.getByText(/Provisioning…/i)).toBeInTheDocument();
      });
      expect(
        screen.getByText(/a database can take a few minutes/i),
      ).toBeInTheDocument();
    });

    it('does not render the Provision button while building', async () => {
      render(
        <PlatformResourcePanel {...BASE_PROPS} dep={depWithParams} />,
        { wrapper },
      );

      await waitFor(() => {
        expect(screen.getByText(/Provisioning…/i)).toBeInTheDocument();
      });
      expect(
        screen.queryByRole('button', { name: /^provision$/i }),
      ).not.toBeInTheDocument();
    });

    it('calls provisioningApi.getStatus to poll', async () => {
      render(
        <PlatformResourcePanel {...BASE_PROPS} dep={depWithParams} />,
        { wrapper },
      );

      await waitFor(() => {
        expect(provisioningModule.provisioningApi.getStatus).toHaveBeenCalledWith(
          'my-project',
          'api-service',
          'postgres',
          'development',
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // (c) ready / deployed + outputs — output NAMES rendered (from the status
  //     query only), no values, Re-provision affordance present
  // -------------------------------------------------------------------------
  describe('deployed / ready state', () => {
    beforeEach(() => {
      vi.mocked(provisioningModule.provisioningApi.getStatus).mockResolvedValue({
        status: 'deployed',
        ready: true,
        outputs: [
          { name: 'DATABASE_URL' },
          { name: 'DB_HOST' },
          { name: 'DB_PASSWORD' },
        ],
      });
    });

    it('shows "Provisioned ✓" heading once the status query resolves', async () => {
      render(
        <PlatformResourcePanel {...BASE_PROPS} dep={depWithParams} />,
        { wrapper },
      );

      await waitFor(() => {
        expect(screen.getByText(/Provisioned ✓/)).toBeInTheDocument();
      });
    });

    it('renders output names from the status query', async () => {
      render(
        <PlatformResourcePanel {...BASE_PROPS} dep={depWithParams} />,
        { wrapper },
      );

      await waitFor(() => {
        expect(screen.getByText('DATABASE_URL')).toBeInTheDocument();
      });
      expect(screen.getByText('DB_HOST')).toBeInTheDocument();
      expect(screen.getByText('DB_PASSWORD')).toBeInTheDocument();
    });

    it('does NOT render any output value strings (secret safety)', async () => {
      // Outputs carry only names (the wire shape has no value field at all —
      // masked at the BFF). The component must render ONLY the name strings.
      vi.mocked(provisioningModule.provisioningApi.getStatus).mockResolvedValue({
        status: 'deployed',
        ready: true,
        outputs: [{ name: 'DB_HOST' }, { name: 'DB_PASSWORD' }],
      });

      render(
        <PlatformResourcePanel {...BASE_PROPS} dep={depWithParams} />,
        { wrapper },
      );

      await waitFor(() => {
        expect(screen.getByText('DB_HOST')).toBeInTheDocument();
      });
      expect(screen.getByText('DB_PASSWORD')).toBeInTheDocument();

      // Exact count: the output list should contain exactly 2 name items.
      const outputNames = screen
        .getAllByText(/^DB_/)
        .filter((el) => el.tagName !== 'INPUT');
      expect(outputNames).toHaveLength(2);

      // Negative: no secret values must leak into the render tree
      expect(screen.queryByText(/password123/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/secretvalue/i)).not.toBeInTheDocument();
    });

    it('renders the Re-provision affordance', async () => {
      render(
        <PlatformResourcePanel {...BASE_PROPS} dep={depWithParams} />,
        { wrapper },
      );

      expect(await screen.findByRole('button', { name: /re-provision/i })).toBeInTheDocument();
    });

    it('renders provisioned view (not spinner) when getStatus returns deployed+ready', async () => {
      vi.mocked(provisioningModule.provisioningApi.getStatus).mockResolvedValue({
        status: 'deployed',
        ready: true,
        outputs: [
          { name: 'REDIS_URL' },
          { name: 'REDIS_PORT' },
        ],
      });

      render(
        <PlatformResourcePanel {...BASE_PROPS} dep={depNoParams} />,
        { wrapper },
      );

      // Provisioned heading must appear (not the loading spinner)
      await waitFor(() => {
        expect(screen.getByText(/Provisioned ✓/)).toBeInTheDocument();
      });

      // Output names from the query result must be rendered once the query resolves
      expect(screen.getByText('REDIS_URL')).toBeInTheDocument();
      expect(screen.getByText('REDIS_PORT')).toBeInTheDocument();

      // Re-provision button must be present
      expect(screen.getByRole('button', { name: /re-provision/i })).toBeInTheDocument();

      // Spinner must NOT be present
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    it('clicking Re-provision calls provisioningApi.provision again', async () => {
      vi.mocked(provisioningModule.provisioningApi.provision).mockResolvedValue(undefined);
      const onChanged = vi.fn();

      render(
        <PlatformResourcePanel
          {...BASE_PROPS}
          dep={depWithParams}
          onChanged={onChanged}
        />,
        { wrapper },
      );

      const reProvisionBtn = await screen.findByRole('button', { name: /re-provision/i });
      fireEvent.click(reProvisionBtn);

      await waitFor(() => {
        expect(provisioningModule.provisioningApi.provision).toHaveBeenCalledWith(
          'my-project',
          'api-service',
          'postgres',
          expect.objectContaining({
            environments: ['development'],
          }),
        );
      });

      expect(onChanged).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // (d) failed state — error message + retry button
  // -------------------------------------------------------------------------
  describe('failed state', () => {
    beforeEach(() => {
      vi.mocked(provisioningModule.provisioningApi.getStatus).mockResolvedValue({
        status: 'failed',
        ready: false,
        outputs: [],
      });
    });

    it('shows error alert and Retry button when status is failed', async () => {
      render(
        <PlatformResourcePanel {...BASE_PROPS} dep={depWithParams} />,
        { wrapper },
      );

      await waitFor(() => {
        expect(screen.getByText(/Provisioning failed/i)).toBeInTheDocument();
      });

      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });
  });
});
