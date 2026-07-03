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
import { useCreateProject, useGithubOrg } from "../api/queries";
import {
  isValidProjectName,
  repoUrlFor,
  suggestProjectName,
} from "../lib/projectName";

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
  const { data: githubOrg } = useGithubOrg();
  const createProject = useCreateProject();

  const start = (chosenPrompt: string) => {
    setPrompt(chosenPrompt);
    setName(suggestProjectName(chosenPrompt));
    createProject.reset();
    setStep("confirm");
  };

  const nameError = name && !isValidProjectName(name)
    ? "Lowercase letters, digits, and dashes; must start with a letter."
    : null;

  const accept = () => {
    createProject.mutate(
      { name, prompt },
      {
        onSuccess: (project) =>
          void navigate({
            to: "/projects/$projectName",
            params: { projectName: project.name },
          }),
      },
    );
  };

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
              onChange={(e) => setName(e.target.value)}
              error={Boolean(nameError)}
              helperText={
                nameError ?? "Suggested from your prompt — change it if you like."
              }
              fullWidth
            />
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <GitHub size={18} />
              <Typography variant="body2" color="text.secondary">
                Specs and source will live in{" "}
                <Box component="span" sx={{ fontFamily: "monospace" }}>
                  {repoUrlFor(githubOrg ?? null, name)}
                </Box>
              </Typography>
            </Stack>
            {createProject.isError && (
              <Alert severity="error">
                {createProject.error instanceof Error
                  ? createProject.error.message
                  : "Failed to create project"}
              </Alert>
            )}
            <Stack direction="row" spacing={2} sx={{ justifyContent: "flex-end" }}>
              <Button
                startIcon={<ArrowLeft size={18} />}
                onClick={() => setStep("prompt")}
                disabled={createProject.isPending}
              >
                Back
              </Button>
              <Button
                variant="contained"
                onClick={accept}
                disabled={!name || Boolean(nameError) || createProject.isPending}
                loading={createProject.isPending}
              >
                Create project
              </Button>
            </Stack>
          </Stack>
        )}
      </Box>
    </PageContent>
  );
}
