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

/**
 * PlatformResourcePanel — provision form, async status polling, name-only
 * outputs, and re-provision (rotation) for `platform-resource` dependencies.
 *
 * Unlike `org-service` (resolved read-time by `resolveOrgServices`) and
 * `external` (resolved read-time from `needsSpec`/`specPath`), the aep-api
 * design read never computes `Dependency.Status` for `platform-resource` —
 * it is always empty on this kind (see `models/design.go` /
 * `artifact_store.go`: only org-service gets a read-time 4-state resolution
 * today). The provisioning-status endpoint (`provisioningApi.getStatus`) is
 * therefore the ONLY source of truth for whether a platform-resource
 * dependency has been provisioned — this panel always queries it, rather
 * than gating on `dep.status`.
 *
 * Security: outputs are name-only (values masked at the BFF); secret values
 * are never surfaced by the status endpoint and are never rendered here. The
 * design-time `Dependency` shape carries no `outputs` field at all.
 *
 * Polling: stops once the task reaches a terminal state (deployed / failed) or
 * the OC binding's Ready condition is True. Tab-visibility gating is global
 * (QueryClient refetchIntervalInBackground:false set in main.tsx).
 */

import type { JSX } from 'react';
import { useState } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, TextField, Typography } from '@wso2/oxygen-ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Dependency } from '../../services/api/types';
import { provisioningApi } from '../../services/api/provisioning';
import { ApiError } from '../../services/api/rest';

// ---------------------------------------------------------------------------
// Terminal states — polling stops when any of these is reached or ready===true.
// Mirrors the resource-provisioning task status (pending|building|deployed|
// failed) surfaced by `provisioningApi.getStatus`.
// ---------------------------------------------------------------------------
const TERMINAL_STATUSES = new Set(['deployed', 'failed']);

function isTerminal(status: string | undefined, ready: boolean | undefined): boolean {
  if (ready) return true;
  if (!status) return false;
  return TERMINAL_STATUSES.has(status);
}

const POLL_INTERVAL_MS = 5_000;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface PlatformResourcePanelProps {
  dep: Dependency;
  projectId: string;
  component: string;
  onChanged: () => void;
}

// ---------------------------------------------------------------------------
// Param form — one TextField per dep.parameters key
// ---------------------------------------------------------------------------
function ParamForm({
  dep,
  projectId,
  component,
  onChanged,
  submitLabel = 'Provision',
}: PlatformResourcePanelProps & { submitLabel?: string }): JSX.Element {
  const params = dep.parameters ?? {};
  const paramKeys = Object.keys(params);

  const [values, setValues] = useState<Record<string, string>>(
    // Pre-fill from dep.parameters (architect defaults)
    Object.fromEntries(paramKeys.map((k) => [k, params[k] ?? ''])),
  );

  const mutation = useMutation({
    mutationFn: () =>
      provisioningApi.provision(projectId, component, dep.name, {
        params: paramKeys.length > 0 ? values : undefined,
        environments: ['development'],
      }),
    onSuccess: () => {
      onChanged();
    },
  });

  const errorMsg = mutation.isError
    ? mutation.error instanceof ApiError
      ? `${mutation.error.message} (HTTP ${mutation.error.status})`
      : mutation.error instanceof Error
        ? mutation.error.message
        : 'Provision failed'
    : null;

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
        Provisioning parameters
      </Typography>

      {paramKeys.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          No parameters required — the resource type defaults will be used.
        </Typography>
      ) : (
        <Stack spacing={2} sx={{ mb: 2 }}>
          {paramKeys.map((k) => (
            <TextField
              key={k}
              label={k}
              value={values[k] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [k]: e.target.value }))}
              fullWidth
              size="small"
            />
          ))}
        </Stack>
      )}

      {errorMsg && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMsg}
        </Alert>
      )}

      <Button
        variant="contained"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
      >
        {mutation.isPending ? 'Requesting…' : submitLabel}
      </Button>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------
export function PlatformResourcePanel({
  dep,
  projectId,
  component,
  onChanged,
}: PlatformResourcePanelProps): JSX.Element {
  // Always query — dep.status carries no resolution signal for this kind
  // (see file-header note), so the status endpoint is the only source of
  // truth for whether provisioning has been attempted or completed.
  const statusQuery = useQuery({
    queryKey: ['resourceStatus', projectId, component, dep.name],
    queryFn: () => provisioningApi.getStatus(projectId, component, dep.name, 'development'),
    refetchInterval: (q) => {
      const data = q.state.data;
      if (isTerminal(data?.status, data?.ready)) return false;
      return POLL_INTERVAL_MS;
    },
  });

  const effectiveStatus = statusQuery.data?.status;
  const effectiveReady = statusQuery.data?.ready === true;
  // Output names are surfaced ONLY by the status endpoint — the design-time
  // Dependency carries no `outputs` field at all.
  const outputs = statusQuery.data?.outputs ?? [];

  // -------------------------------------------------------------------------
  // While the real provisioning status loads, don't guess — otherwise a
  // never-provisioned resource briefly flashes the wrong state.
  // -------------------------------------------------------------------------
  if (statusQuery.isLoading) {
    return (
      <Stack direction="row" alignItems="center" spacing={1.5}>
        <CircularProgress size={18} />
        <Typography variant="body2" color="text.secondary">
          Checking provisioning status…
        </Typography>
      </Stack>
    );
  }

  // -------------------------------------------------------------------------
  // State: deployed / ready — show outputs + re-provision. Only a genuinely
  // provisioned resource (binding Ready, or the task deployed) qualifies.
  // -------------------------------------------------------------------------
  if (effectiveReady || effectiveStatus === 'deployed') {
    return (
      <Box>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
          <Typography variant="subtitle2">Provisioned ✓</Typography>
        </Stack>

        {outputs.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              The following outputs are injected into your component at runtime.
              Values are stored in the OC-rendered Secret and are not displayed
              here.
            </Typography>
            <Stack spacing={0.5}>
              {outputs.map((o) => (
                <Typography key={o.name} variant="body2" fontFamily="monospace">
                  {o.name}
                </Typography>
              ))}
            </Stack>
          </Box>
        )}

        {/* Re-provision (rotation) */}
        <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Re-provision to rotate credentials or apply updated parameters.
          </Typography>
          <ParamForm
            dep={dep}
            projectId={projectId}
            component={component}
            onChanged={onChanged}
            submitLabel="Re-provision"
          />
        </Box>
      </Box>
    );
  }

  // -------------------------------------------------------------------------
  // State: failed
  // -------------------------------------------------------------------------
  if (effectiveStatus === 'failed') {
    return (
      <Box>
        <Alert severity="error" sx={{ mb: 2 }}>
          Provisioning failed. Review the task logs and retry below.
        </Alert>
        <ParamForm
          dep={dep}
          projectId={projectId}
          component={component}
          onChanged={onChanged}
          submitLabel="Retry"
        />
      </Box>
    );
  }

  // -------------------------------------------------------------------------
  // State: building (in-flight, not yet terminal)
  // -------------------------------------------------------------------------
  if (effectiveStatus === 'building' && !isTerminal(effectiveStatus, effectiveReady)) {
    return (
      <Box>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.5 }}>
          <CircularProgress size={18} />
          <Typography variant="body2">
            Provisioning… (a database can take a few minutes)
          </Typography>
        </Stack>
        {statusQuery.data && (
          <Typography variant="caption" color="text.secondary">
            Status: {statusQuery.data.status}
          </Typography>
        )}
      </Box>
    );
  }

  // -------------------------------------------------------------------------
  // Fallback: status is "pending" (never provisioned) or the status query
  // failed — show the provision form so the user can kick it off.
  // -------------------------------------------------------------------------
  return (
    <ParamForm
      dep={dep}
      projectId={projectId}
      component={component}
      onChanged={onChanged}
      submitLabel="Provision"
    />
  );
}
