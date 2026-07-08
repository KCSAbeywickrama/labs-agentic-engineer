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
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@wso2/oxygen-ui";
import {
  CircleCheck,
  ExternalLink,
  GitPullRequest,
  Globe,
  Link2,
  Upload,
} from "@wso2/oxygen-ui-icons-react";
import type { components } from "../../../generated/aep-api";
import {
  useCreateSkill,
  useImportSkill,
  useImportSkillUrl,
} from "../api/queries";

type ImportResult = components["schemas"]["ImportResult"];

// The community path is guidance + link-out only (issue #96 re-grill): no
// proxying of the unofficial skills.sh registry API.
const SKILLS_SH_URL = "https://skills.sh";

type ImportMethod = "upload" | "url" | "community" | "pr";

function slugFromFileName(fileName: string): string {
  return fileName
    .replace(/\.(md|tgz|tar\.gz)$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// A SKILL.md's canonical file name carries no skill name — prefer the
// frontmatter `name:` and fall back to the file name slug.
function skillNameFromMd(fileName: string, skillMd: string): string {
  const fromFrontmatter = /^name:\s*(.+)$/m.exec(skillMd)?.[1]?.trim();
  return fromFrontmatter || slugFromFileName(fileName);
}

// Every path lands the skill in the org skills repo — the BE commits on the
// action paths; the guidance paths (community → paste URL, PR → GitHub) end
// there too because the repo is the catalogue's source of truth.
export function ImportSkillDialog({
  open,
  onClose,
  repoUrl,
}: {
  open: boolean;
  onClose: () => void;
  repoUrl?: string;
}) {
  const [method, setMethod] = useState<ImportMethod>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const importTarball = useImportSkill();
  const importUrl = useImportSkillUrl();
  const createSkill = useCreateSkill();

  const pending =
    importTarball.isPending || importUrl.isPending || createSkill.isPending;
  const submitError =
    fileError ??
    (importTarball.isError ? importTarball.error.message : null) ??
    (importUrl.isError ? importUrl.error.message : null) ??
    (createSkill.isError ? createSkill.error.message : null);

  const resetSubmission = () => {
    importTarball.reset();
    importUrl.reset();
    createSkill.reset();
    setFile(null);
    setUrl("");
    setFileError(null);
    setResult(null);
  };

  const close = () => {
    resetSubmission();
    setMethod("upload");
    onClose();
  };

  const submitUpload = () => {
    if (!file) return;
    setFileError(null);
    if (/\.(tgz|tar\.gz)$/i.test(file.name)) {
      importTarball.mutate(file, { onSuccess: setResult });
      return;
    }
    // Single SKILL.md — rides the create endpoint; there is no separate
    // authoring surface (issue #96 re-grill: import is the only ingestion).
    file
      .text()
      .then((skillMd) => {
        createSkill.mutate(
          {
            name: skillNameFromMd(file.name, skillMd),
            skillMd,
            references: {},
          },
          {
            onSuccess: (created) =>
              setResult({
                name: created.name,
                kind: created.kind,
                warnings: [],
              }),
          },
        );
      })
      .catch(() => setFileError("Could not read the selected file"));
  };

  const submitUrl = () => {
    if (!url.trim()) return;
    importUrl.mutate(url.trim(), { onSuccess: setResult });
  };

  const warnings = result?.warnings ?? [];

  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>Import skill</DialogTitle>

      {result ? (
        <>
          <DialogContent
            sx={{ display: "flex", flexDirection: "column", gap: 2 }}
          >
            <Alert severity="success" icon={<CircleCheck size={20} />}>
              <strong>{result.name}</strong> is in the org skills repo.
            </Alert>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              <Chip label={result.kind} size="small" variant="outlined" />
              {result.license && (
                <Chip
                  label={`license: ${result.license}`}
                  size="small"
                  variant="outlined"
                />
              )}
              {result.compatibility && (
                <Chip
                  label={`compatibility: ${result.compatibility}`}
                  size="small"
                  variant="outlined"
                />
              )}
            </Box>
            {warnings.length > 0 && (
              <Alert severity="warning">
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                  Imported with warnings
                </Typography>
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {warnings.map((warning) => (
                    <li key={warning}>
                      <Typography variant="body2">{warning}</Typography>
                    </li>
                  ))}
                </Box>
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={resetSubmission}>Import another</Button>
            <Button variant="contained" onClick={close}>
              Done
            </Button>
          </DialogActions>
        </>
      ) : (
        <>
          <DialogContent
            sx={{ display: "flex", flexDirection: "column", gap: 2 }}
          >
            <Tabs
              value={method}
              onChange={(_, v) => {
                resetSubmission();
                setMethod(v as ImportMethod);
              }}
              variant="scrollable"
              allowScrollButtonsMobile
            >
              <Tab
                value="upload"
                icon={<Upload size={16} />}
                iconPosition="start"
                label="Upload file"
              />
              <Tab
                value="url"
                icon={<Link2 size={16} />}
                iconPosition="start"
                label="From URL"
              />
              <Tab
                value="community"
                icon={<Globe size={16} />}
                iconPosition="start"
                label="Community"
              />
              <Tab
                value="pr"
                icon={<GitPullRequest size={16} />}
                iconPosition="start"
                label="Via pull request"
              />
            </Tabs>

            {method === "upload" && (
              <>
                <DialogContentText>
                  Upload a single <code>SKILL.md</code>, or a gzip-compressed
                  AgentSkills tarball for a multi-file skill (SKILL.md +
                  references).
                </DialogContentText>
                <Box>
                  <Button
                    component="label"
                    variant="outlined"
                    startIcon={<Upload size={18} />}
                  >
                    Choose file
                    <input
                      type="file"
                      accept=".md,.tgz,.tar.gz,text/markdown,application/gzip"
                      hidden
                      onChange={(e) => {
                        setFileError(null);
                        setFile(e.target.files?.[0] ?? null);
                      }}
                    />
                  </Button>
                  {file && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 1 }}
                    >
                      {file.name}
                    </Typography>
                  )}
                </Box>
              </>
            )}

            {method === "url" && (
              <>
                <DialogContentText>
                  Paste a direct file URL — a raw <code>SKILL.md</code> or a{" "}
                  <code>.tar.gz</code> AgentSkills tarball. The platform
                  fetches and validates it, then commits it to the org skills
                  repo.
                </DialogContentText>
                <TextField
                  label="Skill URL"
                  placeholder="https://raw.githubusercontent.com/…/SKILL.md"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  fullWidth
                />
              </>
            )}

            {method === "community" && (
              <>
                <DialogContentText>
                  Community skills are shared through the AgentSkills
                  ecosystem (the <code>npx skills</code> registry). Browse the
                  catalogue, open a skill&apos;s source, and copy the URL of
                  its raw <code>SKILL.md</code> or tarball — then import it
                  here.
                </DialogContentText>
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                  <Button
                    variant="outlined"
                    endIcon={<ExternalLink size={16} />}
                    href={SKILLS_SH_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Browse skills.sh
                  </Button>
                  <Button variant="text" onClick={() => setMethod("url")}>
                    I have the URL
                  </Button>
                </Box>
              </>
            )}

            {method === "pr" && (
              <>
                <DialogContentText>
                  Skills are files in the org skills repo — author one as a
                  pull request:
                </DialogContentText>
                <Box component="ol" sx={{ m: 0, pl: 3 }}>
                  <li>
                    <Typography variant="body2">
                      Branch the org skills repo and add{" "}
                      <code>skills/&lt;name&gt;/SKILL.md</code> (plus any
                      reference files).
                    </Typography>
                  </li>
                  <li>
                    <Typography variant="body2">
                      Open a pull request and get it reviewed and merged.
                    </Typography>
                  </li>
                  <li>
                    <Typography variant="body2">
                      Done — the catalogue reads the repo directly, so the
                      skill appears here on merge.
                    </Typography>
                  </li>
                </Box>
                {repoUrl && (
                  <Box>
                    <Button
                      variant="outlined"
                      endIcon={<ExternalLink size={16} />}
                      href={repoUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open the org skills repo
                    </Button>
                  </Box>
                )}
              </>
            )}

            {submitError && <Alert severity="error">{submitError}</Alert>}
          </DialogContent>
          <DialogActions>
            <Button onClick={close}>
              {method === "upload" || method === "url" ? "Cancel" : "Close"}
            </Button>
            {method === "upload" && (
              <Button
                variant="contained"
                onClick={submitUpload}
                disabled={!file || pending}
              >
                {pending ? "Importing…" : "Import"}
              </Button>
            )}
            {method === "url" && (
              <Button
                variant="contained"
                onClick={submitUrl}
                disabled={!url.trim() || pending}
              >
                {pending ? "Importing…" : "Import"}
              </Button>
            )}
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
