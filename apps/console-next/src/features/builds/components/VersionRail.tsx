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

import { createLink, useNavigate } from "@tanstack/react-router";
import { Box, ButtonBase, NativeSelect, Typography } from "@wso2/oxygen-ui";
import { PHONE } from "../../shell/layout";
import { soft } from "../../spec/components/Tag";
import { useBuildOutcome } from "../hooks/useBuildOutcome";
import { isBuilding, versionState, type VersionRow } from "../model/ledger";

// The Builds card's ledger, down its side as the spec card's files are: each
// version, newest first, with its state in a few words. At phone width it
// gives way to a picker above the run, as the spec card's rail does.

const VersionLink = createLink(ButtonBase);

function useRowState(projectName: string, row: VersionRow) {
  const { outcome } = useBuildOutcome(projectName, isBuilding(row.status) ? undefined : row.version);
  return versionState(row.status, outcome);
}

function RailRow({ projectName, row, selected }: { projectName: string; row: VersionRow; selected: boolean }) {
  const state = useRowState(projectName, row);
  return (
    <VersionLink
      to="/projects/$projectName/builds/$version"
      params={{ projectName, version: row.version }}
      aria-current={selected ? "page" : undefined}
      sx={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: 1,
        py: 0.75,
        px: 1.25,
        borderRadius: 1.5,
        fontSize: "0.8125rem",
        color: selected ? "primary.main" : "text.primary",
        fontWeight: selected ? 600 : 400,
        bgcolor: selected ? soft("primary") : "transparent",
        "&:hover": { bgcolor: selected ? soft("primary") : "action.hover" },
      }}
    >
      <Box component="span" sx={{ fontFamily: "monospace" }}>
        {row.version}
      </Box>
      <Box
        component="span"
        sx={{
          ml: "auto",
          fontSize: "0.6875rem",
          fontWeight: 400,
          whiteSpace: "nowrap",
          color: state.tone ? `${state.tone}.main` : "text.secondary",
        }}
      >
        {state.label}
      </Box>
    </VersionLink>
  );
}

export function VersionRail({
  projectName,
  rows,
  selected,
}: {
  projectName: string;
  rows: VersionRow[];
  selected: string;
}) {
  return (
    <Box
      component="nav"
      aria-label="Versions"
      sx={{
        width: 200,
        flexShrink: 0,
        borderRight: 1,
        borderColor: "divider",
        overflowY: "auto",
        px: 1,
        pt: 1.75,
        pb: 10,
        display: "flex",
        flexDirection: "column",
        gap: 0.125,
        [PHONE]: { display: "none" },
      }}
    >
      <Typography
        component="h3"
        sx={{
          px: 1.25,
          pt: 1.25,
          pb: 0.5,
          fontSize: "0.6875rem",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          fontWeight: 600,
          color: "text.secondary",
        }}
      >
        Versions
      </Typography>
      {rows.map((row) => (
        <RailRow key={row.version} projectName={projectName} row={row} selected={row.version === selected} />
      ))}
    </Box>
  );
}

function PickerOption({ projectName, row }: { projectName: string; row: VersionRow }) {
  const state = useRowState(projectName, row);
  return <option value={row.version}>{`${row.version} · ${state.label}`}</option>;
}

/** At phone width the rail gives way to this: the same versions, in a picker above the run. */
export function VersionPicker({
  projectName,
  rows,
  selected,
}: {
  projectName: string;
  rows: VersionRow[];
  selected: string;
}) {
  const navigate = useNavigate();
  return (
    <NativeSelect
      value={selected}
      onChange={(e) =>
        void navigate({ to: "/projects/$projectName/builds/$version", params: { projectName, version: e.target.value } })
      }
      inputProps={{ "aria-label": "Open version" }}
      sx={{ display: "none", mb: 2.5, width: "100%", [PHONE]: { display: "inline-flex" } }}
    >
      {rows.map((row) => (
        <PickerOption key={row.version} projectName={projectName} row={row} />
      ))}
    </NativeSelect>
  );
}
