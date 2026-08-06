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

import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@wso2/oxygen-ui";
import { Plus, Trash2, X } from "@wso2/oxygen-ui-icons-react";
import type { components } from "../../../generated/aep-api";
import {
  useComponentConfig,
  useUpdateComponentConfig,
} from "../api/queries";

type EnvVar = components["schemas"]["EnvVar"];

// The component env-var editor (#395, decision 4): opened from a Development
// component row, saving over PUT …/configs — the endpoint's semantics are a
// FULL REPLACE, so the dialog edits the whole list and sends it back whole.
// The BFF mirrors saved values onto every environment's ReleaseBinding
// (config_service.go), which is why the caption says "every environment"
// rather than the dev column the row sits in: the editor must not promise a
// scoping the platform doesn't have. Values are env vars, not secrets (the
// contract's EnvVar carries no secret flag), so they render plaintext.

/** One editable row. `id` keeps React keys stable while keys are renamed. */
interface Row {
  id: number;
  key: string;
  value: string;
}

function toRows(envVars: EnvVar[] | null | undefined): Row[] {
  return (envVars ?? []).map((v, i) => ({ id: i, key: v.key, value: v.value }));
}

export function ComponentConfigDialog({
  open,
  onClose,
  projectName,
  componentName,
  displayName,
}: {
  open: boolean;
  onClose: () => void;
  projectName: string;
  componentName: string;
  displayName: string;
}) {
  const config = useComponentConfig(projectName, componentName, open);
  const update = useUpdateComponentConfig(projectName, componentName);

  // The edit buffer: null = not seeded yet. Seeded ONCE per opening (the
  // functional update keeps an already-seeded buffer, so an unstable
  // config.data identity cannot re-seed — or loop — mid-edit) and dropped on
  // close, so an abandoned edit never survives into the next opening.
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (!open) {
      setRows(null);
      update.reset();
      return;
    }
    if (config.data !== undefined) {
      setRows((prev) => prev ?? toRows(config.data?.envVars));
    }
    // update.reset is stable (react-query); depending on `update` would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, config.data]);

  const editRow = (id: number, patch: Partial<Pick<Row, "key" | "value">>) =>
    setRows((rs) => (rs ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id: number) =>
    setRows((rs) => (rs ?? []).filter((r) => r.id !== id));
  const addRow = () =>
    setRows((rs) => [
      ...(rs ?? []),
      { id: Math.max(-1, ...(rs ?? []).map((r) => r.id)) + 1, key: "", value: "" },
    ]);

  const trimmed = (rows ?? []).map((r) => ({ ...r, key: r.key.trim() }));
  const keys = trimmed.filter((r) => r.key !== "").map((r) => r.key);
  const hasEmptyKey = trimmed.some((r) => r.key === "");
  const hasDuplicate = new Set(keys).size !== keys.length;
  const saveable = rows !== null && !hasEmptyKey && !hasDuplicate;

  const save = () => {
    if (!saveable) return;
    update.mutate(
      { envVars: trimmed.map(({ key, value }) => ({ key, value })) },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        Configuration — {displayName}
        <IconButton
          aria-label="Close"
          onClick={onClose}
          size="small"
          sx={{ position: "absolute", right: 12, top: 12 }}
        >
          <X size={18} />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Environment variables for this component. Applies to every
          environment this component runs in.
        </Typography>
        {config.isPending && open ? (
          <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
            <CircularProgress size={28} aria-label="Loading configuration" />
          </Box>
        ) : config.isError ? (
          <Alert
            severity="error"
            action={<Button onClick={() => void config.refetch()}>Retry</Button>}
          >
            Failed to load configuration
            {config.error instanceof Error && config.error.message
              ? `: ${config.error.message}`
              : ""}
          </Alert>
        ) : (
          <Stack spacing={1.25}>
            {(rows ?? []).length === 0 && (
              <Typography variant="body2" color="text.secondary">
                No variables yet — add the first one.
              </Typography>
            )}
            {(rows ?? []).map((row) => (
              <Stack
                key={row.id}
                direction="row"
                spacing={1}
                sx={{ alignItems: "center" }}
              >
                <TextField
                  label="Key"
                  size="small"
                  value={row.key}
                  onChange={(e) => editRow(row.id, { key: e.target.value })}
                  sx={{ flex: 1, "& input": { fontFamily: "monospace" } }}
                />
                <TextField
                  label="Value"
                  size="small"
                  value={row.value}
                  onChange={(e) => editRow(row.id, { value: e.target.value })}
                  sx={{ flex: 1.4, "& input": { fontFamily: "monospace" } }}
                />
                <IconButton
                  aria-label={`Remove ${row.key || "variable"}`}
                  size="small"
                  onClick={() => removeRow(row.id)}
                >
                  <Trash2 size={16} />
                </IconButton>
              </Stack>
            ))}
            <Box>
              <Button
                size="small"
                variant="outlined"
                color="inherit"
                startIcon={<Plus size={14} />}
                onClick={addRow}
              >
                Add variable
              </Button>
            </Box>
            {hasDuplicate && (
              <Alert severity="warning">Keys must be unique.</Alert>
            )}
            {update.isError && (
              <Alert severity="error">
                {update.error instanceof Error && update.error.message
                  ? update.error.message
                  : "Failed to save configuration"}
              </Alert>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ flexGrow: 1, minWidth: 0 }}
        >
          Saving replaces the component's whole variable list.
        </Typography>
        <Button onClick={onClose} variant="outlined" color="inherit">
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={save}
          disabled={!saveable || update.isPending || config.isPending}
        >
          {update.isPending ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
