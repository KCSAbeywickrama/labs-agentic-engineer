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
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  PageContent,
  Stack,
  TextField,
  Typography,
} from "@wso2/oxygen-ui";
import { Plus, Trash2 } from "@wso2/oxygen-ui-icons-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { EmptyState } from "../../../components/EmptyState";
import { PageHeader } from "../../../components/PageHeader";
import type { components } from "../../../generated/aep-api";
import {
  useExternalResources,
  useOrgEnvironments,
  useRegisterExternalResource,
  useUpdateExternalResource,
} from "../api/queries";
import { isRegisteredExternal } from "../kind";

type ConfigKeyDTO = components["schemas"]["ConfigKeyDTO"];
type EnvValueCellDTO = components["schemas"]["EnvValueCellDTO"];
type ExternalResourceDTO = components["schemas"]["ExternalResourceDTO"];
type ResourceDocPointerDTO = components["schemas"]["ResourceDocPointerDTO"];
type DocType = ResourceDocPointerDTO["type"];

type DocRow = {
  type: DocType;
  url: string;
};

const KEEP_SECRET_HELPER = "Leave blank to keep the current value";

function slugFrom(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
  return slug || "resource";
}

function pointersFromRows(rows: DocRow[]): ResourceDocPointerDTO[] {
  const minted: ResourceDocPointerDTO[] = [];
  for (const row of rows) {
    const url = row.url.trim();
    if (url) minted.push({ type: row.type, url });
  }
  return minted;
}

function envFieldLabel(environment: string, key: string): string {
  return `${environment} · ${key.trim() || "(unnamed key)"}`;
}

function cellKey(environment: string, key: string): string {
  return `${environment}:${key}`;
}

function cellStatus(
  cells: EnvValueCellDTO[] | null | undefined,
  environment: string,
  key: string,
): EnvValueCellDTO["status"] {
  const cell = (cells ?? []).find(
    (c) => c.environment === environment && c.key === key,
  );
  return cell?.status === "configured" ? "configured" : "unset";
}

function prefillFrom(record: ExternalResourceDTO): {
  name: string;
  description: string;
  consumptionInstructions: string;
  keys: ConfigKeyDTO[];
  values: Record<string, string>;
  docs: DocRow[];
} {
  const keys = (record.config ?? []).map((k) => ({
    key: k.key,
    description: k.description ?? "",
    secret: Boolean(k.secret),
  }));
  const secretKeys = new Set(keys.filter((k) => k.secret).map((k) => k.key));
  const values: Record<string, string> = {};
  for (const cell of record.envCells ?? []) {
    values[cellKey(cell.environment, cell.key)] = secretKeys.has(cell.key)
      ? ""
      : (cell.value ?? "");
  }
  const docs: DocRow[] = [];
  for (const doc of record.resourceDocs ?? []) {
    if (doc.url) docs.push({ type: doc.type, url: doc.url });
  }
  return {
    name: record.name,
    description: record.description ?? "",
    consumptionInstructions: record.consumptionInstructions ?? "",
    keys,
    values,
    docs,
  };
}

export function RegisterFormPage({
  prompt = "",
  name: editName,
}: {
  prompt?: string;
  name?: string;
}) {
  const isEdit = Boolean(editName);
  const navigate = useNavigate();
  const environments = useOrgEnvironments();
  const register = useRegisterExternalResource();
  const update = useUpdateExternalResource(editName ?? "");
  const resources = useExternalResources();

  const record = (resources.data ?? []).find((r) => r.name === editName);
  const editing =
    isEdit && record != null && isRegisteredExternal(record) ? record : undefined;

  const [name, setName] = useState(isEdit ? (editName ?? "") : slugFrom(prompt));
  const [description, setDescription] = useState(isEdit ? "" : prompt);
  const [consumptionInstructions, setConsumptionInstructions] = useState("");
  const [keys, setKeys] = useState<ConfigKeyDTO[]>(
    isEdit ? [] : [{ key: "API_KEY", description: "API secret", secret: true }],
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [prefilledName, setPrefilledName] = useState<string | null>(null);

  useEffect(() => {
    if (!editing || prefilledName === editing.name) return;
    const next = prefillFrom(editing);
    setName(next.name);
    setDescription(next.description);
    setConsumptionInstructions(next.consumptionInstructions);
    setKeys(next.keys);
    setValues(next.values);
    setDocs(next.docs);
    setPrefilledName(editing.name);
  }, [editing, prefilledName]);

  const envNames = (environments.data ?? []).map((e) => e.name);
  const envCells = editing?.envCells;

  const missingValue =
    envNames.length === 0 ||
    keys.some((cfg) =>
      envNames.some((environment) => {
        const filled = (values[cellKey(environment, cfg.key)] ?? "").trim();
        if (filled) return false;
        if (
          isEdit &&
          cfg.secret &&
          cellStatus(envCells, environment, cfg.key) === "configured"
        ) {
          return false;
        }
        return true;
      }),
    );

  const canSubmit =
    Boolean(name.trim()) &&
    Boolean(description.trim()) &&
    Boolean(consumptionInstructions.trim()) &&
    keys.length > 0 &&
    keys.every((k) => k.key.trim() && (k.description ?? "").trim()) &&
    !missingValue &&
    !environments.isLoading &&
    !environments.isError &&
    !(isEdit && !editing);

  const submitError = isEdit
    ? update.error instanceof Error
      ? update.error.message
      : null
    : register.error instanceof Error
      ? register.error.message
      : null;
  const submitPending = isEdit ? update.isPending : register.isPending;

  const submit = () => {
    const resourceDocs = pointersFromRows(docs);
    const body = {
      name: name.trim(),
      description: description.trim(),
      consumptionInstructions: consumptionInstructions.trim(),
      config: keys,
      envValues: keys.flatMap((cfg) =>
        envNames.map((environment) => ({
          environment,
          key: cfg.key,
          value: values[cellKey(environment, cfg.key)] ?? "",
        })),
      ),
      ...(resourceDocs.length > 0 ? { resourceDocs } : {}),
    };
    const onSuccess = () => {
      void navigate({ to: "/resources" });
    };
    if (isEdit) {
      update.mutate(body, { onSuccess });
      return;
    }
    register.mutate(body, { onSuccess });
  };

  return (
    <PageContent>
      <PageHeader
        title="Register External resource"
        subtitle="Environment values are form-only."
        backTo={{
          link: <Link to="/resources" />,
          label: "Back to Resources",
        }}
      />
      {environments.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load environments
        </Alert>
      )}
      {submitError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {submitError}
        </Alert>
      )}
      <Stack spacing={3} sx={{ maxWidth: 720 }}>
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={isEdit}
        />
        <TextField
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          multiline
          minRows={2}
        />

        <Box>
          <Stack direction="row" sx={{ justifyContent: "space-between", mb: 1 }}>
            <Typography variant="subtitle1">Config keys</Typography>
            {!isEdit && (
              <Button
                size="small"
                startIcon={<Plus size={14} />}
                onClick={() =>
                  setKeys((prev) => [
                    ...prev,
                    { key: "", description: "", secret: false },
                  ])
                }
              >
                Add key
              </Button>
            )}
          </Stack>
          <Stack spacing={2}>
            {keys.map((cfg, index) => (
              <Stack
                key={index}
                direction="row"
                spacing={1}
                sx={{ alignItems: "center" }}
              >
                <TextField
                  label="Key"
                  value={cfg.key}
                  onChange={(e) =>
                    setKeys((prev) =>
                      prev.map((row, i) =>
                        i === index ? { ...row, key: e.target.value } : row,
                      ),
                    )
                  }
                  sx={{ flex: 1 }}
                  disabled={isEdit}
                />
                <TextField
                  label="Description"
                  value={cfg.description ?? ""}
                  onChange={(e) =>
                    setKeys((prev) =>
                      prev.map((row, i) =>
                        i === index
                          ? { ...row, description: e.target.value }
                          : row,
                      ),
                    )
                  }
                  sx={{ flex: 2 }}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={Boolean(cfg.secret)}
                      disabled={isEdit}
                      onChange={(e) =>
                        setKeys((prev) =>
                          prev.map((row, i) =>
                            i === index
                              ? { ...row, secret: e.target.checked }
                              : row,
                          ),
                        )
                      }
                    />
                  }
                  label="Secret"
                />
                {!isEdit && (
                  <IconButton
                    aria-label="Remove key"
                    disabled={keys.length === 1}
                    onClick={() =>
                      setKeys((prev) => prev.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 size={16} />
                  </IconButton>
                )}
              </Stack>
            ))}
          </Stack>
        </Box>

        <Box>
          <Typography variant="subtitle1" gutterBottom>
            Environment values
          </Typography>
          {environments.isLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
              <CircularProgress aria-label="Loading environments" />
            </Box>
          ) : environments.isError ? null : envNames.length === 0 ? (
            <EmptyState
              compact
              bordered
              title="No OpenChoreo Environments"
              description="This organization has no OpenChoreo Environments, so environment values cannot be filled."
            />
          ) : (
            <Stack spacing={2} sx={{ pl: 2 }}>
              {keys.map((cfg, index) => (
                <Box key={cfg.key || `pending-${index}`}>
                  <Typography
                    variant="subtitle2"
                    color="text.secondary"
                    sx={{ mb: 1 }}
                  >
                    {cfg.key || "(unnamed key)"}
                  </Typography>
                  <Stack spacing={1.5}>
                    {envNames.map((environment) => {
                      const status = cellStatus(envCells, environment, cfg.key);
                      return (
                        <Stack
                          key={environment}
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: "flex-start" }}
                        >
                          <TextField
                            label={envFieldLabel(environment, cfg.key)}
                            type={cfg.secret ? "password" : "text"}
                            value={values[cellKey(environment, cfg.key)] ?? ""}
                            onChange={(e) =>
                              setValues((prev) => ({
                                ...prev,
                                [cellKey(environment, cfg.key)]: e.target.value,
                              }))
                            }
                            sx={{ flex: 1 }}
                            {...(isEdit && cfg.secret
                              ? { helperText: KEEP_SECRET_HELPER }
                              : {})}
                          />
                          {isEdit && (
                            <Chip
                              size="small"
                              variant="outlined"
                              label={
                                status === "configured" ? "Configured" : "Unset"
                              }
                              sx={{ mt: 1 }}
                            />
                          )}
                        </Stack>
                      );
                    })}
                  </Stack>
                </Box>
              ))}
            </Stack>
          )}
        </Box>

        <Divider />

        <TextField
            label="Consumption instructions"
            value={consumptionInstructions}
            onChange={(e) => setConsumptionInstructions(e.target.value)}
            required
            multiline
            minRows={3}
            fullWidth
          />

        <Box>
          <Stack direction="row" sx={{ justifyContent: "space-between", mb: 0.5 }}>
            <Typography variant="subtitle1">Resource docs</Typography>
            <Button
              size="small"
              startIcon={<Plus size={14} />}
              onClick={() =>
                setDocs((prev) => [
                  ...prev,
                  { type: "documentation", url: "" },
                ])
              }
            >
              Add doc
            </Button>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Optional. Each doc is a URL pointer — type plus URL.
          </Typography>
          {docs.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No docs yet. Add a spec or documentation if agents should read one.
            </Typography>
          ) : (
            <Stack spacing={2}>
              {docs.map((doc, index) => (
                <Stack
                  key={index}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center" }}
                >
                  <TextField
                    select
                    size="small"
                    label="Type"
                    value={doc.type}
                    onChange={(e) =>
                      setDocs((prev) =>
                        prev.map((row, i) =>
                          i === index
                            ? { ...row, type: e.target.value as DocType }
                            : row,
                        ),
                      )
                    }
                    sx={{ width: 168, flexShrink: 0 }}
                  >
                    <MenuItem value="documentation">Documentation</MenuItem>
                    <MenuItem value="openapi">OpenAPI</MenuItem>
                    <MenuItem value="graphql">GraphQL</MenuItem>
                    <MenuItem value="asyncapi">AsyncAPI</MenuItem>
                    <MenuItem value="protobuf">Protobuf</MenuItem>
                  </TextField>
                  <TextField
                    size="small"
                    label="URL"
                    value={doc.url}
                    onChange={(e) =>
                      setDocs((prev) =>
                        prev.map((row, i) =>
                          i === index ? { ...row, url: e.target.value } : row,
                        ),
                      )
                    }
                    placeholder="https://"
                    sx={{ flex: 1, minWidth: 0 }}
                  />
                  <IconButton
                    aria-label="Remove doc"
                    onClick={() =>
                      setDocs((prev) => prev.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </Stack>
              ))}
            </Stack>
          )}
        </Box>

        <Stack direction="row" spacing={2} sx={{ justifyContent: "flex-end" }}>
          <Button onClick={() => void navigate({ to: "/resources" })}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={submit}
            disabled={!canSubmit || submitPending}
            loading={submitPending}
          >
            {isEdit ? "Save" : "Register"}
          </Button>
        </Stack>
      </Stack>
    </PageContent>
  );
}
