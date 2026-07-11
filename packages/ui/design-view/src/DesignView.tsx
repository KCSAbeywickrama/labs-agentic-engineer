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

import { useMemo } from "react";
import { Alert, Box, Chip, Typography } from "@wso2/oxygen-ui";
import {
  parseComponentDesign,
  type ComponentDesign,
  type Dependency,
} from "./parse.js";

// Solid background per component type / dependency kind. Text color is
// computed for contrast (getContrastText), so labels stay readable in both
// themes — the same approach as the OpenAPI viewer's method badges.
const TYPE_COLOR: Record<string, string> = {
  service: "#1976d2",
  "web-application": "#7b1fa2",
  "scheduled-task": "#ed6c02",
  worker: "#2e7d32",
};
const KIND_COLOR: Record<string, string> = {
  component: "#1976d2",
  "org-service": "#7b1fa2",
  external: "#ed6c02",
  "platform-resource": "#0288d1",
};
const KIND_LABEL: Record<string, string> = {
  component: "component",
  "org-service": "org service",
  external: "external",
  "platform-resource": "platform",
};
const FALLBACK = "#616161";

function SolidBadge({ label, color }: { label: string; color: string }) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        px: 1,
        py: 0.5,
        borderRadius: 1,
        flexShrink: 0,
        fontFamily: "monospace",
        fontSize: "0.6875rem",
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        bgcolor: color,
        color: theme.palette.getContrastText(color),
      })}
    >
      {label}
    </Box>
  );
}

const mono = { fontFamily: "monospace", fontSize: "0.875rem" } as const;

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: "flex", gap: 2, alignItems: "baseline" }}>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ minWidth: 96, flexShrink: 0 }}
      >
        {label}
      </Typography>
      <Typography component="span" sx={mono}>
        {value}
      </Typography>
    </Box>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="overline"
      color="text.secondary"
      sx={{ display: "block", mt: 3, mb: 1, fontWeight: 700, letterSpacing: "0.08em" }}
    >
      {children}
    </Typography>
  );
}

// A dependency reads as: what kind it is (the badge), its name, and a
// one-line description. The authored config/resourceType/spec/parameters are
// deliberately not surfaced here — they are integration detail, not design.
function DependencyCard({ dep }: { dep: Dependency }) {
  const color = KIND_COLOR[dep.kind] ?? FALLBACK;
  const kindLabel = KIND_LABEL[dep.kind] ?? dep.kind;
  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        p: 1.5,
        mb: 1,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <SolidBadge label={kindLabel} color={color} />
        <Typography component="span" sx={{ ...mono, fontWeight: 600 }}>
          {dep.name}
        </Typography>
      </Box>
      {dep.description && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {dep.description}
        </Typography>
      )}
    </Box>
  );
}

function DesignBody({ design }: { design: ComponentDesign }) {
  const typeColor = TYPE_COLOR[design.type] ?? FALLBACK;
  return (
    <Box sx={{ height: "100%", overflow: "auto", p: 3 }}>
      <Box sx={{ maxWidth: 960, mx: "auto" }}>
        {/* Header bar — type + version sit above the name as an eyebrow row */}
        {(design.type || design.version) && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            {design.type && <SolidBadge label={design.type} color={typeColor} />}
            {design.version && (
              <Chip label={`v${design.version}`} size="small" variant="outlined" />
            )}
          </Box>
        )}
        <Typography variant="h4" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
          {design.name || "component"}
        </Typography>

        {/* Facts — each labeled so a bare value like "docker" isn't ambiguous */}
        <Box sx={{ mt: 2, display: "flex", flexDirection: "column", gap: 0.5 }}>
          {design.language && <Fact label="Language" value={design.language} />}
          {design.buildpack && <Fact label="Buildpack" value={design.buildpack} />}
          {design.exposure && <Fact label="Exposure" value={design.exposure} />}
          {design.appPath && <Fact label="App path" value={design.appPath} />}
          {design.entrypoint && <Fact label="Entrypoint" value={design.entrypoint} />}
          {design.endpoint && <Fact label="Endpoint" value={design.endpoint.name} />}
        </Box>

        {/* Description */}
        {design.description && (
          <>
            <SectionHeading>Description</SectionHeading>
            <Typography variant="body1" color="text.secondary">
              {design.description}
            </Typography>
          </>
        )}

        {/* Dependencies */}
        <SectionHeading>Dependencies</SectionHeading>
        {design.dependencies.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No dependencies.
          </Typography>
        ) : (
          design.dependencies.map((dep, i) => (
            <DependencyCard key={`${dep.kind}:${dep.name}:${i}`} dep={dep} />
          ))
        )}
      </Box>
    </Box>
  );
}

export interface DesignViewProps {
  /** Raw component design.json text. */
  design: string;
}

export function DesignView({ design }: DesignViewProps) {
  const parsed = useMemo(() => parseComponentDesign(design), [design]);
  if ("kind" in parsed) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          Couldn't parse this component's design.json: {parsed.message}
        </Alert>
      </Box>
    );
  }
  return <DesignBody design={parsed} />;
}
