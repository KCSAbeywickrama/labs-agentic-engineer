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
  TextField,
} from "@wso2/oxygen-ui";
import { useSkill, useUpdateSkill } from "../api/queries";

export function EditSkillDialog({
  name,
  onClose,
}: {
  name: string | null;
  onClose: () => void;
}) {
  const { data: skill, isLoading } = useSkill(name ?? "");
  const updateSkill = useUpdateSkill(name ?? "");
  const [skillMd, setSkillMd] = useState("");

  useEffect(() => {
    if (skill) setSkillMd(skill.skillMd);
  }, [skill]);

  const close = () => {
    updateSkill.reset();
    onClose();
  };

  const submit = () => {
    if (!skill) return;
    updateSkill.mutate(
      { skillMd, references: skill.references },
      { onSuccess: close },
    );
  };

  return (
    <Dialog open={name !== null} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>Edit {name}</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
        {isLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <TextField
            label="SKILL.md"
            value={skillMd}
            onChange={(e) => setSkillMd(e.target.value)}
            multiline
            minRows={12}
            fullWidth
            slotProps={{ input: { sx: { fontFamily: "monospace", fontSize: 13 } } }}
          />
        )}
        {updateSkill.isError && (
          <Alert severity="error">{updateSkill.error.message}</Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={!skillMd || updateSkill.isPending || isLoading}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
