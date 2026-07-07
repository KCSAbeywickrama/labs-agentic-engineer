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

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
  Typography,
} from "@wso2/oxygen-ui";
import type { components } from "../../../generated/aep-api";
import { useSyncSkills } from "../api/queries";

type SkillUpdate = components["schemas"]["SkillUpdate"];

export function SyncUpdatesPanel({ updates }: { updates: SkillUpdate[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const syncSkills = useSyncSkills();

  if (updates.length === 0) return null;

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const submit = () => {
    syncSkills.mutate(Array.from(selected), {
      onSuccess: () => setSelected(new Set()),
    });
  };

  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent sx={{ p: 3 }}>
        <Typography variant="subtitle1" gutterBottom>
          Updates available ({updates.length})
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column", mb: 2 }}>
          {updates.map((u) => (
            <FormControlLabel
              key={u.name}
              control={
                <Checkbox
                  checked={selected.has(u.name)}
                  onChange={() => toggle(u.name)}
                />
              }
              label={
                <Typography variant="body2">
                  {u.name}{" "}
                  <Typography component="span" variant="body2" color="text.secondary">
                    ({u.repoVersion === -1 ? "not yet installed" : `v${u.repoVersion}`} → v
                    {u.embeddedVersion})
                  </Typography>
                </Typography>
              }
            />
          ))}
        </Box>
        {syncSkills.isError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {syncSkills.error.message}
          </Alert>
        )}
        <Button
          variant="contained"
          size="small"
          onClick={submit}
          disabled={selected.size === 0 || syncSkills.isPending}
        >
          {syncSkills.isPending ? "Syncing…" : `Sync selected (${selected.size})`}
        </Button>
      </CardContent>
    </Card>
  );
}
