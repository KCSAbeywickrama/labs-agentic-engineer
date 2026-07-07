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
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@wso2/oxygen-ui";
import { useCreateSkill } from "../api/queries";

const PLACEHOLDER = `---
name: my-skill
description: What this skill does and when to use it.
---

Instructions body...`;

export function CreateSkillDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [skillMd, setSkillMd] = useState("");
  const createSkill = useCreateSkill();

  const close = () => {
    createSkill.reset();
    setName("");
    setSkillMd("");
    onClose();
  };

  const submit = () => {
    createSkill.mutate(
      { name, skillMd, references: {} },
      { onSuccess: close },
    );
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>Create skill</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
        <TextField
          label="Name"
          placeholder="my-skill"
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
        />
        <TextField
          label="SKILL.md"
          placeholder={PLACEHOLDER}
          value={skillMd}
          onChange={(e) => setSkillMd(e.target.value)}
          multiline
          minRows={12}
          fullWidth
          slotProps={{ input: { sx: { fontFamily: "monospace", fontSize: 13 } } }}
        />
        {createSkill.isError && (
          <Alert severity="error">{createSkill.error.message}</Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={!name || !skillMd || createSkill.isPending}
        >
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}
