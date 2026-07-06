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
 * Org-level External Resources catalog. Lists every registered external
 * resource (the reusable org-wide definition the architect discovers via the
 * dependency catalog and projects provision values into), shows which
 * project/components consume each, and lets an operator delete one — but only
 * when nothing uses it (the server enforces the same guard, returning 409
 * with the consumer list in the message otherwise).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@wso2/oxygen-ui';
import { Boxes, CheckCircle, Lock, Trash2 } from '@wso2/oxygen-ui-icons-react';

import { externalResourcesApi } from '../services/api/externalResources';
import type { ExternalResource } from '../services/api/types';
import { ApiError } from '../services/api/rest';

export default function ExternalResourcesSettings(): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [externalResources, setExternalResources] = useState<ExternalResource[]>([]);
  const [pendingDelete, setPendingDelete] = useState<ExternalResource | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setExternalResources(await externalResourcesApi.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load external resources.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
        <Typography>Loading external resources…</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Boxes size={22} />
        <Typography variant="h5">External resources</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        External resources registered for this organization. Each is defined once and reused by
        any project that declares it. An external resource can be deleted only when no component
        uses it.
      </Typography>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={<Button onClick={() => void load()}>Retry</Button>}
        >
          {error}
        </Alert>
      )}

      {externalResources.length === 0 ? (
        <Alert severity="info">
          No external resources registered yet. They appear here once a project&apos;s design
          declares an <code>external</code> dependency.
        </Alert>
      ) : (
        <Stack spacing={2}>
          {externalResources.map((resource) => {
            const inUse = resource.consumers.length > 0;
            return (
              <Card key={resource.name} variant="outlined">
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Box sx={{ pr: 2, minWidth: 0 }}>
                      <Typography variant="h6">{resource.name}</Typography>
                      {resource.description && (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                          {resource.description}
                        </Typography>
                      )}
                      <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
                        {resource.configKeys.map((k) => (
                          <Chip
                            key={k.key}
                            size="small"
                            variant="outlined"
                            icon={k.secret ? <Lock size={12} /> : undefined}
                            label={k.key}
                          />
                        ))}
                      </Stack>
                      <Box sx={{ mt: 1.5 }}>
                        {inUse ? (
                          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
                            <Typography variant="caption" color="text.secondary">
                              Used by:
                            </Typography>
                            {resource.consumers.map((u) => (
                              <Chip
                                key={`${u.projectId}/${u.componentName}`}
                                size="small"
                                color="primary"
                                label={`${u.projectId} / ${u.componentName}`}
                              />
                            ))}
                          </Stack>
                        ) : (
                          <Chip
                            size="small"
                            color="success"
                            icon={<CheckCircle size={14} />}
                            label="Not used — deletable"
                          />
                        )}
                      </Box>
                    </Box>
                    <Button
                      variant="outlined"
                      color="error"
                      startIcon={<Trash2 size={16} />}
                      disabled={inUse}
                      onClick={() => setPendingDelete(resource)}
                      sx={{ flexShrink: 0 }}
                    >
                      Delete
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}

      {pendingDelete && (
        <DeleteDialog
          resource={pendingDelete}
          onClose={() => setPendingDelete(null)}
          onDeleted={() => {
            setPendingDelete(null);
            void load();
          }}
        />
      )}
    </Box>
  );
}

interface DeleteDialogProps {
  resource: ExternalResource;
  onClose: () => void;
  onDeleted: () => void;
}

function DeleteDialog({ resource, onClose, onDeleted }: DeleteDialogProps): React.ReactElement {
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setDeleting(true);
    setErr(null);
    try {
      await externalResourcesApi.delete(resource.name);
      onDeleted();
    } catch (e) {
      // On a 409 (still in use), the server's message already lists the
      // consumers ("… in use by proj/comp, proj2/comp2 — remove those
      // components first") — surface it verbatim rather than a generic string.
      const msg =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Delete failed';
      setErr(msg);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open onClose={deleting ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Delete “{resource.name}”?</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">
          This removes the org-level registration. Its stored secret values and the shared
          resource type are not affected; any project that re-declares it will register it again.
        </Typography>
        {err && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {err}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={deleting}>
          Cancel
        </Button>
        <Button color="error" variant="contained" onClick={() => void run()} disabled={deleting}>
          {deleting ? 'Deleting…' : 'Delete'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
