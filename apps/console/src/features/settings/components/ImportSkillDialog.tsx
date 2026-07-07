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
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Typography,
} from "@wso2/oxygen-ui";
import { Upload } from "@wso2/oxygen-ui-icons-react";
import { useImportSkill } from "../api/queries";

export function ImportSkillDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const importSkill = useImportSkill();

  const close = () => {
    importSkill.reset();
    setFile(null);
    onClose();
  };

  const submit = () => {
    if (!file) return;
    importSkill.mutate(file, { onSuccess: close });
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle>Import skill</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <DialogContentText>
          Upload a gzip-compressed AgentSkills tarball.
        </DialogContentText>
        <Box>
          <Button component="label" variant="outlined" startIcon={<Upload size={18} />}>
            Choose file
            <input
              type="file"
              accept=".tgz,.tar.gz,application/gzip"
              hidden
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Button>
          {file && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {file.name}
            </Typography>
          )}
        </Box>
        {importSkill.isError && (
          <Alert severity="error">{importSkill.error.message}</Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={!file || importSkill.isPending}
        >
          {importSkill.isPending ? "Importing…" : "Import"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
