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

/**
 * DependencyPage — one external dependency's page in the spec view: what it
 * is, where it stands, and the one thing the user can do about it.
 *
 * One dependency, one definition: the page reads the hydrated edge (identical
 * on every consumer) and the files in the dependency's own directory. Three
 * things move a dependency forward, and all three live here rather than in
 * chat: **Resolve** runs the guided flow (`/resolve-dependency <name>`),
 * **Provide the contract** takes a URL or a dropped file straight into the
 * directory, and **Accept** records the user's permission to build against a
 * contract the agent wrote. Question cards the flow asks render on the spec
 * view around this page, so the user never leaves it.
 */

import { useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@wso2/oxygen-ui";
import { FileText, Plug, TriangleAlert, Upload } from "@wso2/oxygen-ui-icons-react";
import { dependencyFilePath, type DesignDependencyNode } from "../api/designTree";
import {
  useAcceptDependencyAssumption,
  useProvideDependencyContract,
} from "../api/queries";
import type { DependencyState } from "../lib/dependencyStates";

const STYLE_LABEL: Record<string, string> = {
  "rest-api": "REST API",
  graphql: "GraphQL",
  sdk: "SDK",
};

function SectionHeading({ children }: { children: string }) {
  return (
    <Typography variant="overline" color="text.secondary" sx={{ display: "block", mt: 3, mb: 1 }}>
      {children}
    </Typography>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: "flex", gap: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ width: 120, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
        {value}
      </Typography>
    </Box>
  );
}

/** The user's routes to a contract: a URL to fetch, or a file to drop. */
function ProvideContract({
  projectName,
  name,
  replacing,
}: {
  projectName: string;
  name: string;
  /** True when a contract already exists (assumed or real) — the copy says "replace". */
  replacing: boolean;
}) {
  const provide = useProvideDependencyContract(projectName);
  const [url, setUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const submitFile = (file: File | undefined) => {
    if (!file) return;
    void file.text().then((content) => provide.mutate({ depName: name, content }));
  };

  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        {replacing
          ? "A document from the provider replaces the contract on file. Paste the URL of its published OpenAPI document, or drop the file here."
          : "Paste the URL of the provider's published OpenAPI document, or drop the file here. The platform validates it and commits it beside this definition."}
      </Typography>
      <Stack direction="row" spacing={1}>
        <TextField
          size="small"
          fullWidth
          label="OpenAPI document URL"
          placeholder="https://…/openapi.yaml"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={provide.isPending}
        />
        <Button
          variant="outlined"
          disabled={url.trim() === "" || provide.isPending}
          loading={provide.isPending}
          onClick={() => provide.mutate({ depName: name, url: url.trim() }, { onSuccess: () => setUrl("") })}
        >
          Fetch
        </Button>
      </Stack>
      <Box
        role="button"
        tabIndex={0}
        aria-label="Drop the contract file here, or choose one"
        onClick={() => fileInput.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") fileInput.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          submitFile(e.dataTransfer.files[0]);
        }}
        sx={{
          border: 1,
          borderStyle: "dashed",
          borderColor: dragging ? "primary.main" : "divider",
          borderRadius: 1,
          p: 2,
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          cursor: "pointer",
          color: "text.secondary",
        }}
      >
        <Upload size={18} />
        <Typography variant="body2">
          Drop an OpenAPI document (YAML or JSON) here, or click to choose one.
        </Typography>
        <input
          ref={fileInput}
          type="file"
          accept=".yaml,.yml,.json,application/json,text/yaml"
          hidden
          onChange={(e) => {
            submitFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </Box>
      {provide.isError && (
        <Typography variant="body2" color="error">
          {provide.error instanceof Error ? provide.error.message : "The document was not accepted."}
        </Typography>
      )}
      {provide.isSuccess && (
        <Typography variant="body2" color="success.main">
          Contract committed — the dependency is resolved on the next read.
        </Typography>
      )}
    </Stack>
  );
}

export function DependencyPage({
  projectName,
  name,
  state,
  node,
  onOpenFile,
  onResolve,
  onReconsider,
}: {
  projectName: string;
  name: string;
  /** The folded state, when the dependencies read model knows the name. */
  state: DependencyState | undefined;
  /** The dependency's directory as the file list sees it, when it exists. */
  node: DesignDependencyNode | undefined;
  onOpenFile: (path: string) => void;
  /** Runs the guided flow for this dependency. */
  onResolve: (name: string) => void;
  /** Opens a conversation about an already-resolved choice. */
  onReconsider: (name: string) => void;
}) {
  const dep = state?.dependency;
  const accept = useAcceptDependencyAssumption(projectName);
  const resolved = dep?.status === "resolved";
  const awaitingAcceptance = dep?.reason === "needs-acceptance";
  const hasContract = Boolean(dep?.contract);
  // Narrowed once: inside the JSX closures TypeScript loses the `dep?.contract`
  // guard, and the path helper takes the bare file name.
  const contractFile = dep?.contract ?? "";
  const sdkFile = dep?.sdk ?? "";

  return (
    <Box sx={{ height: "100%", overflow: "auto", p: 3 }}>
      <Box sx={{ maxWidth: 960, mx: "auto" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, flexWrap: "wrap" }}>
          <Chip size="small" icon={<Plug size={14} />} label="External dependency" />
          {dep?.style && <Chip size="small" variant="outlined" label={STYLE_LABEL[dep.style] ?? dep.style} />}
          {state?.flags.map((f) => (
            <Chip key={f} size="small" variant="outlined" label={f} />
          ))}
          {state?.blocking && (
            <Chip
              size="small"
              color="warning"
              variant="outlined"
              icon={<TriangleAlert size={12} />}
              label={state.todo}
            />
          )}
          {resolved && !state?.blocking && (
            <Chip size="small" color="success" variant="outlined" label="Resolved" />
          )}
        </Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
          <Typography variant="h4" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            {name}
          </Typography>
          {resolved ? (
            // A reconsider is a conversation about a consumer's choice; with no
            // consumer there is nobody to reconsider for.
            state && state.usedBy.length > 0 && (
              <Button variant="outlined" onClick={() => onReconsider(name)}>
                Reconsider
              </Button>
            )
          ) : (
            <Button variant="contained" onClick={() => onResolve(name)}>
              Resolve
            </Button>
          )}
        </Stack>
        {dep?.provider && (
          <Typography variant="subtitle1" color="text.secondary" sx={{ mt: 0.5 }}>
            {dep.provider}
          </Typography>
        )}
        {dep?.description && (
          <Typography variant="body1" color="text.secondary" sx={{ mt: 2 }}>
            {dep.description}
          </Typography>
        )}
        {!dep && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            No component references this dependency yet; its files are below.
          </Typography>
        )}

        {state && state.usedBy.length > 0 && (
          <>
            <SectionHeading>Used by</SectionHeading>
            <Stack direction="row" spacing={0.5} flexWrap="wrap">
              {state.usedBy.map((c) => (
                <Chip key={c} size="small" variant="outlined" label={c} />
              ))}
            </Stack>
          </>
        )}

        {dep?.candidates && dep.candidates.length > 0 && (
          <>
            <SectionHeading>Candidates</SectionHeading>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              More than one system fits. Resolve to choose one — or name another.
            </Typography>
            <Stack spacing={1}>
              {dep.candidates.map((c) => (
                <Box key={c.name} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="subtitle2">{c.name}</Typography>
                    <Chip size="small" variant="outlined" label={STYLE_LABEL[c.style] ?? c.style} />
                  </Stack>
                  {c.description && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {c.description}
                    </Typography>
                  )}
                </Box>
              ))}
            </Stack>
          </>
        )}

        <SectionHeading>Contract</SectionHeading>
        {awaitingAcceptance && dep && (
          <Box sx={{ border: 1, borderColor: "warning.main", borderRadius: 1, p: 2, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              The agent wrote this contract from research
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              No published document was found. Accepting lets the build code against the
              agent&apos;s contract as written; it stays marked assumed everywhere until a real
              document replaces it.
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                loading={accept.isPending}
                onClick={() => accept.mutate({ depName: name })}
              >
                Accept the assumption
              </Button>
              {dep.contract && (
                <Button variant="text" onClick={() => onOpenFile(dependencyFilePath(name, contractFile))}>
                  Read it first
                </Button>
              )}
            </Stack>
            {accept.isError && (
              <Typography variant="body2" color="error" sx={{ mt: 1 }}>
                {accept.error instanceof Error ? accept.error.message : "The assumption was not recorded."}
              </Typography>
            )}
          </Box>
        )}
        {dep?.assumed && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Assumed contract, accepted by {dep.assumed.by} on {dep.assumed.at}
            {dep.assumed.note ? ` — ${dep.assumed.note}` : ""}.
          </Typography>
        )}
        {hasContract && dep?.contract ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mb: 2 }}>
            <Button
              variant="text"
              size="small"
              startIcon={<FileText size={14} />}
              sx={{ alignSelf: "flex-start" }}
              onClick={() => onOpenFile(dependencyFilePath(name, contractFile))}
            >
              {dep.contract}
            </Button>
            {dep.provenance?.sourceUrl && <Fact label="Source" value={dep.provenance.sourceUrl} />}
            {dep.provenance?.sliced && <Fact label="Kept" value="the operations the design uses" />}
            {dep.provenance?.fetchedAt && <Fact label="Read on" value={dep.provenance.fetchedAt} />}
          </Box>
        ) : dep?.style === "sdk" && dep.sdk ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            SDK only — no API document beside the manifest.
          </Typography>
        ) : (
          dep &&
          !dep.candidates?.length && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              No contract on file yet.
            </Typography>
          )
        )}
        {dep?.sdk && (
          <Box sx={{ mb: 2 }}>
            <Button
              variant="text"
              size="small"
              startIcon={<FileText size={14} />}
              onClick={() => onOpenFile(dependencyFilePath(name, sdkFile))}
            >
              {dep.sdk}
            </Button>
            {dep.package && <Fact label="Package" value={dep.package} />}
          </Box>
        )}
        {/* A document settles the contract, not the choice: with candidates
            open or nothing identified yet, the provider comes first (Resolve),
            and a registered org dependency's contract is the org record's. */}
        {dep &&
          dep.kind === "external" &&
          dep.source !== "org" &&
          !dep.candidates?.length &&
          Boolean(dep.provider || dep.style) &&
          dep.style !== "graphql" && (
            <ProvideContract projectName={projectName} name={name} replacing={hasContract} />
          )}

        {dep?.config && dep.config.length > 0 && (
          <>
            <SectionHeading>Configuration</SectionHeading>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              The settings every consumer reads. Values are supplied on the build, not here.
            </Typography>
            <Stack spacing={0.75}>
              {dep.config.map((k) => (
                <Box key={k.key} sx={{ display: "flex", gap: 1, alignItems: "baseline", flexWrap: "wrap" }}>
                  <Chip size="small" label={k.key} color={k.secret ? "warning" : "default"} />
                  {k.description && (
                    <Typography variant="body2" color="text.secondary">
                      {k.description}
                    </Typography>
                  )}
                </Box>
              ))}
            </Stack>
          </>
        )}

        {node && (node.definitionPath || node.files.length > 0) && (
          <>
            <Divider sx={{ mt: 3 }} />
            <SectionHeading>Files</SectionHeading>
            <Stack spacing={0.25} alignItems="flex-start">
              {node.definitionPath && (
                <Button variant="text" size="small" startIcon={<FileText size={14} />} onClick={() => onOpenFile(node.definitionPath!)}>
                  dependency.json
                </Button>
              )}
              {node.files.map((f) => (
                <Button key={f.path} variant="text" size="small" startIcon={<FileText size={14} />} onClick={() => onOpenFile(f.path)}>
                  {f.path.slice(f.path.lastIndexOf("/") + 1)}
                </Button>
              ))}
            </Stack>
          </>
        )}
      </Box>
    </Box>
  );
}
