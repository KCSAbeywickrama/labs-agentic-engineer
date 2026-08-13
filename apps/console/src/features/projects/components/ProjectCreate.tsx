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
  CardActionArea,
  CardContent,
  Chip,
  Grid,
  PageContent,
  Stack,
  TextField,
  Typography,
} from "@wso2/oxygen-ui";
import {
  ArrowLeft,
  GitHub,
  ShoppingCart,
  Dumbbell,
  ReceiptText,
} from "@wso2/oxygen-ui-icons-react";
import { useNavigate } from "@tanstack/react-router";
import {
  useCreateProject,
  useGithubOrg,
  useUploadReferences,
} from "../api/queries";
import { isValidProjectName, suggestProjectName } from "../lib/projectName";
import { ReferenceFilePicker, formatFileSize } from "./ReferenceFilePicker";

// Issue #71 decision: clicking an example acts as prompt + Start in one
// click — it jumps straight to the name/repo confirmation step.
const EXAMPLE_PROMPTS = [
  {
    icon: <ShoppingCart size={24} />,
    title: "Online store",
    prompt:
      "An online store for handmade ceramics with a product catalog, cart, and checkout",
  },
  {
    icon: <Dumbbell size={24} />,
    title: "Workout tracker",
    prompt:
      "A gym workout tracker where I can log exercises, sets, and weights and see progress over time",
  },
  {
    icon: <ReceiptText size={24} />,
    title: "Invoicing tool",
    prompt:
      "An invoicing tool for freelancers that creates invoices, tracks payments, and exports PDFs",
  },
] as const;

function ExampleCard({
  icon,
  title,
  prompt,
  onPick,
}: (typeof EXAMPLE_PROMPTS)[number] & { onPick: (prompt: string) => void }) {
  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardActionArea sx={{ height: "100%" }} onClick={() => onPick(prompt)}>
        <CardContent>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mb: 1 }}>
            {icon}
            <Typography variant="subtitle1">{title}</Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {prompt}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

export function ProjectCreate() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"prompt" | "confirm">("prompt");
  const [prompt, setPrompt] = useState("");
  const [name, setName] = useState("");
  // The repo name follows the project name until the user edits it (#71
  // feedback: repo name is changeable, the org is fixed).
  const [repoName, setRepoName] = useState("");
  const [repoTouched, setRepoTouched] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  // Set once POST /projects succeeds: from that point the project exists, so
  // Back is closed off and the primary action can only be the reference
  // upload's retry (#383 decision: a failed upload is never a failed create).
  const [createdName, setCreatedName] = useState<string | null>(null);
  const { data: githubOrg } = useGithubOrg();
  const createProject = useCreateProject();
  const uploadReferences = useUploadReferences();

  const start = (chosenPrompt: string) => {
    const suggested = suggestProjectName(chosenPrompt);
    setPrompt(chosenPrompt);
    setName(suggested);
    setRepoName(suggested);
    setRepoTouched(false);
    createProject.reset();
    setStep("confirm");
  };

  const changeName = (value: string) => {
    setName(value);
    if (!repoTouched) setRepoName(value);
  };

  const invalidNameMessage =
    "Lowercase letters, digits, and dashes; must start with a letter.";
  const nameError =
    name && !isValidProjectName(name) ? invalidNameMessage : null;
  const repoError =
    repoName && !isValidProjectName(repoName) ? invalidNameMessage : null;

  const goToProject = (projectName: string) => {
    void navigate({
      to: "/projects/$projectName",
      params: { projectName },
    });
  };

  const uploadFor = (projectName: string) => {
    uploadReferences.mutate(
      { projectName, files },
      { onSuccess: () => goToProject(projectName) },
    );
  };

  const accept = () => {
    // The project already exists — only the reference upload failed, so the
    // primary action retries just that.
    if (createdName) {
      uploadFor(createdName);
      return;
    }
    createProject.mutate(
      { name, prompt, ...(repoName !== name && { repoName }) },
      {
        onSuccess: (project) => {
          // No client-side copy of the prompt: the BE persists it into the
          // project's own descriptor (specs/.agentic-engineer.toml) on create,
          // and `/start` reads it back from there — so the idea survives a
          // different browser, device, or teammate.
          if (files.length === 0) {
            goToProject(project.name);
            return;
          }
          // Attached reference documents land as one atomic files/apply
          // commit under specs/requirements/references/ (#383).
          setCreatedName(project.name);
          uploadFor(project.name);
        },
      },
    );
  };

  const pending = createProject.isPending || uploadReferences.isPending;

  return (
    <PageContent>
      <Box sx={{ maxWidth: 720, mx: "auto", pt: { xs: 4, md: 8 } }}>
        {step === "prompt" ? (
          <Stack spacing={4}>
            <Box sx={{ textAlign: "center" }}>
              <Typography variant="h4" gutterBottom>
                What do you want to build?
              </Typography>
              <Typography variant="body1" color="text.secondary">
                Describe it in your own words — AEP turns your requirement
                into a project and starts deriving its design.
              </Typography>
            </Box>
            <Stack spacing={2}>
              <TextField
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. A booking system for a small hair salon with staff calendars and SMS reminders"
                multiline
                minRows={3}
                autoFocus
                fullWidth
              />
              <ReferenceFilePicker files={files} onFilesChange={setFiles} />
              <Box sx={{ textAlign: "right" }}>
                <Button
                  variant="contained"
                  disabled={!prompt.trim()}
                  onClick={() => start(prompt.trim())}
                >
                  Start
                </Button>
              </Box>
            </Stack>
            <Grid container spacing={2}>
              {EXAMPLE_PROMPTS.map((example) => (
                <Grid key={example.title} size={{ xs: 12, sm: 4 }}>
                  <ExampleCard {...example} onPick={start} />
                </Grid>
              ))}
            </Grid>
          </Stack>
        ) : (
          <Stack spacing={3}>
            <Box>
              <Typography variant="h4" gutterBottom>
                Name your project
              </Typography>
              <Typography variant="body2" color="text.secondary">
                “{prompt}”
              </Typography>
            </Box>
            <TextField
              label="Project name"
              value={name}
              onChange={(e) => changeName(e.target.value)}
              error={Boolean(nameError)}
              helperText={
                nameError ?? "Suggested from your prompt — change it if you like."
              }
              fullWidth
            />
            <TextField
              label="Repository name"
              value={repoName}
              onChange={(e) => {
                setRepoTouched(true);
                setRepoName(e.target.value);
              }}
              error={Boolean(repoError)}
              helperText={
                repoError ??
                "Holds the project's specs and source; the organization is fixed."
              }
              fullWidth
              slotProps={{
                input: {
                  startAdornment: (
                    <Stack
                      direction="row"
                      spacing={0.75}
                      sx={{ alignItems: "center", mr: 0.5, flexShrink: 0 }}
                    >
                      <GitHub size={16} />
                      <Typography variant="body2" color="text.secondary">
                        github.com/{githubOrg ?? "<your-org>"}/
                      </Typography>
                    </Stack>
                  ),
                },
              }}
            />
            {files.length > 0 && (
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Reference documents to commit to the project:
                </Typography>
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                  {files.map((file) => (
                    <Chip
                      key={file.name}
                      label={`${file.name} (${formatFileSize(file.size)})`}
                      variant="outlined"
                      size="small"
                    />
                  ))}
                </Box>
              </Box>
            )}
            {createProject.isError && (
              <Alert severity="error">
                {createProject.error instanceof Error
                  ? createProject.error.message
                  : "Failed to create project"}
              </Alert>
            )}
            {createdName && uploadReferences.isError && (
              <Alert severity="error">
                The project was created, but uploading the reference documents
                failed:{" "}
                {uploadReferences.error instanceof Error
                  ? uploadReferences.error.message
                  : "unknown error"}
              </Alert>
            )}
            <Stack direction="row" spacing={2} sx={{ justifyContent: "flex-end" }}>
              <Button
                startIcon={<ArrowLeft size={18} />}
                onClick={() => setStep("prompt")}
                disabled={pending || Boolean(createdName)}
              >
                Back
              </Button>
              {createdName && uploadReferences.isError && (
                <Button
                  onClick={() => goToProject(createdName)}
                  disabled={pending}
                >
                  Continue without documents
                </Button>
              )}
              <Button
                variant="contained"
                onClick={accept}
                disabled={!name || Boolean(nameError) || pending}
                loading={pending}
              >
                {createdName ? "Retry upload" : "Create project"}
              </Button>
            </Stack>
          </Stack>
        )}
      </Box>
    </PageContent>
  );
}
