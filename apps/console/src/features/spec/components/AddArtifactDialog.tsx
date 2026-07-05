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
  FormControlLabel,
  Radio,
  RadioGroup,
  Typography,
} from "@wso2/oxygen-ui";

// Static v1 list (#80 decision); the artifact-creation binding lands as its
// own feature, so this dialog is a preview: selecting a type does nothing.
const ARTIFACT_TYPES = [
  {
    id: "prd",
    label: "PRD",
    description: "Product requirements document — goals, users, requirements.",
  },
  {
    id: "user-stories",
    label: "User stories doc",
    description: "As-a / I-can / so-that stories the agents design against.",
  },
];

export function AddArtifactDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [artifactType, setArtifactType] = useState(
    ARTIFACT_TYPES[0]?.id ?? "prd",
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Add requirement artifact</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2 }}>
          Artifact creation isn't wired up yet — it arrives with its own
          feature. This dialog is a preview.
        </Alert>
        <RadioGroup
          value={artifactType}
          onChange={(e) => setArtifactType(e.target.value)}
        >
          {ARTIFACT_TYPES.map((type) => (
            <FormControlLabel
              key={type.id}
              value={type.id}
              control={<Radio />}
              sx={{ alignItems: "flex-start", mb: 1 }}
              label={
                <>
                  <Typography variant="body1">{type.label}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {type.description}
                  </Typography>
                </>
              }
            />
          ))}
        </RadioGroup>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}
