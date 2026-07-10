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
  Box,
  Button,
  Checkbox,
  Divider,
  Drawer,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from "@wso2/oxygen-ui";
import type { components } from "../../../generated/aep-api";

type PreflightItem = components["schemas"]["PreflightItem"];
type BuildInputItem = components["schemas"]["BuildInputItem"];

/** Per-item working state, keyed by `${component}::${dependency}`. */
type ItemState = {
  /** external-config: value typed per config key, keyed by key name. */
  values: Record<string, string>;
  /** external-spec: URL field. */
  specUrl: string;
  /** external-spec: pasted-content field. */
  specContent: string;
  /** platform-resource / org-service: approval checkbox. */
  approved: boolean;
};

function itemKey(item: PreflightItem): string {
  return `${item.component}::${item.dependency}`;
}

/** Fresh per-item state as if the drawer just opened with this item. */
function seedForItem(item: PreflightItem): ItemState {
  return {
    values: {},
    specUrl: "",
    specContent: "",
    approved:
      item.kind === "platform-resource" || item.kind === "org-service",
  };
}

function initialState(items: PreflightItem[]): Record<string, ItemState> {
  const state: Record<string, ItemState> = {};
  for (const item of items) {
    state[itemKey(item)] = seedForItem(item);
  }
  return state;
}

/** True when this item's required input (if any) has been supplied. */
function isSatisfied(item: PreflightItem, state: ItemState): boolean {
  if (item.kind === "external-config") {
    const keys = item.config ?? [];
    return keys.every((k) => (state.values[k.key] ?? "").trim() !== "");
  }
  if (item.kind === "external-spec") {
    return state.specUrl.trim() !== "" || state.specContent.trim() !== "";
  }
  // platform-resource / org-service are approvals, never a Continue blocker.
  return true;
}

function toBuildInputItem(
  item: PreflightItem,
  state: ItemState,
): BuildInputItem {
  const base = {
    component: item.component,
    dependency: item.dependency,
    kind: item.kind,
  };

  if (item.kind === "external-config") {
    return {
      ...base,
      values: (item.config ?? []).map((k) => ({
        key: k.key,
        value: state.values[k.key] ?? "",
      })),
    };
  }

  if (item.kind === "external-spec") {
    return state.specUrl.trim() !== ""
      ? { ...base, specUrl: state.specUrl }
      : { ...base, specContent: state.specContent };
  }

  if (item.kind === "platform-resource") {
    return {
      ...base,
      approved: state.approved,
      ...(item.parameters ? { parameters: item.parameters } : {}),
    };
  }

  // org-service
  return { ...base, approved: state.approved };
}

function ExternalConfigPanel({
  item,
  state,
  onChange,
}: {
  item: PreflightItem;
  state: ItemState;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <Stack spacing={2}>
      <Typography variant="subtitle1">{item.dependency}</Typography>
      <Typography variant="body2" color="text.secondary">
        {item.description}
      </Typography>
      {(item.config ?? []).map((configKey) => (
        <TextField
          key={configKey.key}
          label={configKey.key}
          type={configKey.secret ? "password" : "text"}
          value={state.values[configKey.key] ?? ""}
          onChange={(e) => onChange(configKey.key, e.target.value)}
          fullWidth
          size="small"
        />
      ))}
    </Stack>
  );
}

function ExternalSpecPanel({
  item,
  state,
  onUrlChange,
  onContentChange,
}: {
  item: PreflightItem;
  state: ItemState;
  onUrlChange: (value: string) => void;
  onContentChange: (value: string) => void;
}) {
  return (
    <Stack spacing={2}>
      <Typography variant="subtitle1">{item.dependency}</Typography>
      <Typography variant="body2" color="text.secondary">
        {item.description}
      </Typography>
      <TextField
        label="Spec URL"
        value={state.specUrl}
        onChange={(e) => onUrlChange(e.target.value)}
        fullWidth
        size="small"
      />
      <Typography variant="caption" color="text.secondary">
        or paste the spec directly
      </Typography>
      <TextField
        label="Spec content"
        value={state.specContent}
        onChange={(e) => onContentChange(e.target.value)}
        multiline
        minRows={4}
        fullWidth
        size="small"
      />
    </Stack>
  );
}

function ApprovalPanel({
  item,
  state,
  description,
  onToggle,
}: {
  item: PreflightItem;
  state: ItemState;
  description: string;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <Stack spacing={1}>
      <FormControlLabel
        control={
          <Checkbox
            checked={state.approved}
            onChange={(e) => onToggle(e.target.checked)}
          />
        }
        label={item.dependency}
      />
      <Typography variant="body2" color="text.secondary">
        {description}
      </Typography>
      {item.parameters ? (
        <Box
          component="pre"
          sx={{
            m: 0,
            p: 1,
            fontSize: "0.75rem",
            bgcolor: "action.hover",
            borderRadius: 1,
            overflowX: "auto",
          }}
        >
          {JSON.stringify(item.parameters, null, 2)}
        </Box>
      ) : null}
    </Stack>
  );
}

export function BuildDependencyDrawer({
  open,
  items,
  onClose,
  onContinue,
  submitting = false,
}: {
  open: boolean;
  items: PreflightItem[];
  onClose: () => void;
  onContinue: (inputs: BuildInputItem[]) => void;
  // True while the parent's build call (POST /build) triggered by Continue is
  // in flight: the Continue button shows a spinner and both buttons disable so
  // the request can't be double-submitted or the drawer dismissed mid-call.
  // The parent closes the drawer on success.
  submitting?: boolean;
}) {
  const [state, setState] = useState<Record<string, ItemState>>(() =>
    initialState(items),
  );

  // Fresh state every time the drawer transitions to open, so a reopened
  // drawer never retains the prior session's typed values/toggles.
  useEffect(() => {
    if (open) {
      setState(initialState(items));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const canContinue = items.every((item) => {
    const itemState = state[itemKey(item)];
    return itemState ? isSatisfied(item, itemState) : false;
  });

  function updateState(item: PreflightItem, patch: Partial<ItemState>) {
    setState((prev) => ({
      ...prev,
      [itemKey(item)]: {
        ...(prev[itemKey(item)] ?? seedForItem(item)),
        ...patch,
      },
    }));
  }

  function handleContinue() {
    const inputs = items.map((item) =>
      toBuildInputItem(item, state[itemKey(item)] ?? seedForItem(item)),
    );
    onContinue(inputs);
  }

  const externalConfigItems = items.filter(
    (i) => i.kind === "external-config",
  );
  const externalSpecItems = items.filter((i) => i.kind === "external-spec");
  const platformResourceItems = items.filter(
    (i) => i.kind === "platform-resource",
  );
  const orgServiceItems = items.filter((i) => i.kind === "org-service");

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box sx={{ width: 420, p: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Dependencies to resolve
        </Typography>

        {externalConfigItems.length > 0 ? (
          <>
            <Stack spacing={3} sx={{ mb: 3 }}>
              {externalConfigItems.map((item) => (
                <ExternalConfigPanel
                  key={itemKey(item)}
                  item={item}
                  state={state[itemKey(item)] ?? seedForItem(item)}
                  onChange={(key, value) =>
                    updateState(item, {
                      values: {
                        ...(state[itemKey(item)] ?? seedForItem(item)).values,
                        [key]: value,
                      },
                    })
                  }
                />
              ))}
            </Stack>
            <Divider sx={{ mb: 3 }} />
          </>
        ) : null}

        {externalSpecItems.length > 0 ? (
          <>
            <Stack spacing={3} sx={{ mb: 3 }}>
              {externalSpecItems.map((item) => (
                <ExternalSpecPanel
                  key={itemKey(item)}
                  item={item}
                  state={state[itemKey(item)] ?? seedForItem(item)}
                  onUrlChange={(value) => updateState(item, { specUrl: value })}
                  onContentChange={(value) =>
                    updateState(item, { specContent: value })
                  }
                />
              ))}
            </Stack>
            <Divider sx={{ mb: 3 }} />
          </>
        ) : null}

        {platformResourceItems.length > 0 ? (
          <>
            <Stack spacing={2} sx={{ mb: 3 }}>
              {platformResourceItems.map((item) => (
                <ApprovalPanel
                  key={itemKey(item)}
                  item={item}
                  state={state[itemKey(item)] ?? seedForItem(item)}
                  description={`Provision this ${item.resourceType ?? "resource"} for you`}
                  onToggle={(checked) =>
                    updateState(item, { approved: checked })
                  }
                />
              ))}
            </Stack>
            <Divider sx={{ mb: 3 }} />
          </>
        ) : null}

        {orgServiceItems.length > 0 ? (
          <Stack spacing={2} sx={{ mb: 3 }}>
            {orgServiceItems.map((item) => (
              <ApprovalPanel
                key={itemKey(item)}
                item={item}
                state={state[itemKey(item)] ?? seedForItem(item)}
                description="Make this cross-project endpoint visible — this updates and rebuilds the owning project; your build continues and the consuming task waits until it's published"
                onToggle={(checked) => updateState(item, { approved: checked })}
              />
            ))}
          </Stack>
        ) : null}

        <Stack direction="row" spacing={2} justifyContent="flex-end">
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            loading={submitting}
            disabled={!canContinue || submitting}
            onClick={handleContinue}
          >
            Continue
          </Button>
        </Stack>
      </Box>
    </Drawer>
  );
}
