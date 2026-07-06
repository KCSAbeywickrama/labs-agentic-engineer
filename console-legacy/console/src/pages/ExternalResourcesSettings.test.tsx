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

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExternalResource } from '../services/api/types';

vi.mock('../services/api/externalResources', () => ({
  externalResourcesApi: {
    list: vi.fn(),
    delete: vi.fn(),
  },
}));

import * as externalResourcesModule from '../services/api/externalResources';
import ExternalResourcesSettings from './ExternalResourcesSettings';

const deletable: ExternalResource = {
  name: 'exchangerate',
  description: 'Exchange rate lookups',
  configKeys: [
    { key: 'EXCHANGERATE_BASE_URL', secret: false },
    { key: 'EXCHANGERATE_API_KEY', secret: true },
  ],
  consumers: [],
};

const inUse: ExternalResource = {
  name: 'payment-gateway',
  configKeys: [{ key: 'API_KEY', secret: true }],
  consumers: [{ projectId: 'storefront', componentName: 'checkout' }],
};

describe('ExternalResourcesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists external resources with their config keys and consumers', async () => {
    vi.mocked(externalResourcesModule.externalResourcesApi.list).mockResolvedValue([
      deletable,
      inUse,
    ]);

    render(<ExternalResourcesSettings />);

    expect(await screen.findByText('exchangerate')).toBeInTheDocument();
    expect(screen.getByText('payment-gateway')).toBeInTheDocument();
    expect(screen.getByText('EXCHANGERATE_API_KEY')).toBeInTheDocument();
    expect(screen.getByText('storefront / checkout')).toBeInTheDocument();
  });

  it('marks an unused resource as deletable and disables Delete for one still in use', async () => {
    vi.mocked(externalResourcesModule.externalResourcesApi.list).mockResolvedValue([
      deletable,
      inUse,
    ]);

    render(<ExternalResourcesSettings />);
    await screen.findByText('exchangerate');

    expect(screen.getByText(/not used — deletable/i)).toBeInTheDocument();

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    // deletable (exchangerate) first, in-use (payment-gateway) second.
    expect(deleteButtons[0]).not.toBeDisabled();
    expect(deleteButtons[1]).toBeDisabled();
  });

  it('deletes a resource and refreshes the list', async () => {
    vi.mocked(externalResourcesModule.externalResourcesApi.list)
      .mockResolvedValueOnce([deletable])
      .mockResolvedValueOnce([]);
    vi.mocked(externalResourcesModule.externalResourcesApi.delete).mockResolvedValue(undefined);

    render(<ExternalResourcesSettings />);
    await screen.findByText('exchangerate');

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      expect(externalResourcesModule.externalResourcesApi.delete).toHaveBeenCalledWith(
        'exchangerate',
      );
    });
    await waitFor(() => {
      expect(screen.queryByText('exchangerate')).not.toBeInTheDocument();
    });
  });

  it('surfaces the server 409 message (with the consumer list) when delete fails', async () => {
    const { ApiError } = await import('../services/api/rest');
    vi.mocked(externalResourcesModule.externalResourcesApi.list).mockResolvedValue([deletable]);
    vi.mocked(externalResourcesModule.externalResourcesApi.delete).mockRejectedValue(
      new ApiError(
        409,
        'external resource is in use by storefront/checkout — remove those components first',
      ),
    );

    render(<ExternalResourcesSettings />);
    await screen.findByText('exchangerate');

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }));

    expect(
      await screen.findByText(/in use by storefront\/checkout — remove those components first/i),
    ).toBeInTheDocument();
  });
});
