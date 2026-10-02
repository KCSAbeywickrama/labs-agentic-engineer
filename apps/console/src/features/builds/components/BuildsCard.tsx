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

import type { ReactNode } from "react";
import { Alert, Box, Button, Skeleton, Typography } from "@wso2/oxygen-ui";
import { CardOverlay } from "../../projects/components/CardOverlay";
import { PHONE } from "../../shell/layout";
import { useBuilds } from "../api/builds";
import { useVersionLedger } from "../api/runs";
import { useBuildAction } from "../buildPicker";
import { selectedRow, versionRows } from "../model/ledger";
import { offeredRows } from "../model/picker";
import { BuildButton } from "./BuildButton";
import { RunView } from "./RunView";
import { VersionPicker, VersionRail } from "./VersionRail";

// The Builds card's body: the versions down its side, and the one picked (the
// newest by default) as its run. As the old console's Builds page, it leads with
// one version's story; an unknown version in the URL falls back to the newest,
// so a stale link degrades to "latest" rather than to nothing.

function names(list: string[]): string {
  return list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

function Padded({ children }: { children: ReactNode }) {
  return <Box sx={{ height: "100%", overflowY: "auto", px: 3.5, pt: 3, pb: 11, [PHONE]: { px: 2, pb: 17.5 } }}>{children}</Box>;
}

/** Before the first build: what is ready for it, and the button that starts it. */
function NoBuilds({ projectName }: { projectName: string }) {
  const build = useBuildAction(projectName);
  const ready = build.offer ? offeredRows(build.offer).flatMap((r) => (r.kind === "feature" ? [r.name] : [])) : [];
  return (
    <Box
      sx={{
        border: 1,
        borderStyle: "dashed",
        borderColor: "divider",
        borderRadius: 2.5,
        px: 2,
        py: 1.75,
        maxWidth: "64ch",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 1,
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        No builds yet.
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {ready.length
          ? `${names(ready)} ${ready.length === 1 ? "is" : "are"} designed and ready for ${build.offer?.version ?? "v1"}.`
          : "A build starts once something is designed. The spec and the design cards say what is left."}
      </Typography>
      {build.label && (
        <Button size="small" variant="contained" onClick={build.open}>
          {build.label}
        </Button>
      )}
    </Box>
  );
}

function BuildsCard({ projectName, version }: { projectName: string; version: string | undefined }) {
  const ledger = useVersionLedger(projectName);
  const builds = useBuilds(projectName);

  if (ledger.isError || builds.isError) {
    const retry = () => void Promise.all([ledger.refetch(), builds.refetch()]);
    return (
      <Padded>
        <Alert severity="error" action={<Button onClick={retry}>Retry</Button>}>
          Couldn't load the builds: {(ledger.error ?? builds.error)?.message}
        </Alert>
      </Padded>
    );
  }
  if (!ledger.data || !builds.data) {
    return (
      <Padded>
        <Skeleton variant="rounded" height={96} sx={{ maxWidth: "64ch" }} />
      </Padded>
    );
  }

  const rows = versionRows(ledger.data, builds.data);
  const row = selectedRow(rows, version);
  if (!row) {
    return (
      <Padded>
        <NoBuilds projectName={projectName} />
      </Padded>
    );
  }
  return (
    <Box sx={{ display: "flex", height: "100%", minHeight: 0 }}>
      <VersionRail projectName={projectName} rows={rows} selected={row.version} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Padded>
          <VersionPicker projectName={projectName} rows={rows} selected={row.version} />
          <RunView key={row.version} projectName={projectName} row={row} rows={rows} />
        </Padded>
      </Box>
    </Box>
  );
}

/** The Builds card as its routes draw it: over the overview, with Build v2 in its header once one is offered. */
export function BuildsCardRoute({ projectName, version }: { projectName: string; version: string | undefined }) {
  return (
    <CardOverlay card="builds" fill actions={<BuildButton projectName={projectName} size="small" />}>
      <BuildsCard projectName={projectName} version={version} />
    </CardOverlay>
  );
}
