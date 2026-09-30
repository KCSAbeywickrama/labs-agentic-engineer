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

import { createLink } from "@tanstack/react-router";
import { Box, Button, ButtonBase, Typography } from "@wso2/oxygen-ui";
import type * as Y from "yjs";
import type { Proposal } from "../api/specModel";
import { PRODUCT_KEY, type NamedFile } from "../model/files";
import { useProposalVerdict } from "../useSpecActions";
import { PHONE } from "../../shell/layout";
import { soft } from "./Tag";

const FileLink = createLink(ButtonBase);

/**
 * The agent's pending change, above whichever file is open: what it is, the
 * files it touches (each opens that file, where its lines are drawn in the
 * proposal colour and can be edited), and Accept or Discard for all of it.
 */
export function ProposalBar({
  projectName,
  doc,
  proposal,
  files,
  current,
}: {
  projectName: string;
  doc: Y.Doc;
  proposal: Proposal;
  files: NamedFile[];
  current: string;
}) {
  const { settle, pending, error } = useProposalVerdict(projectName, doc);
  return (
    <Box
      role="region"
      aria-label="Proposed change"
      sx={{
        // Flush with the top of the scrolling pane, over its padding: a sticky
        // box stops at the padding edge unless it is offset past it.
        position: "sticky",
        top: (t) => t.spacing(-3),
        zIndex: 2,
        mx: -3.5,
        mt: -3,
        mb: 2.5,
        px: 3.5,
        py: 1.25,
        // Opaque under the wash: the document scrolls beneath it.
        bgcolor: "background.paper",
        backgroundImage: `linear-gradient(${soft("info")}, ${soft("info")})`,
        borderBottom: 1,
        borderColor: "info.main",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "8px 12px",
        fontSize: "0.8125rem",
        [PHONE]: { mx: -2, px: 2 },
      }}
    >
      <Typography component="p" sx={{ fontSize: "inherit" }}>
        <Box component="b" sx={{ fontWeight: 600 }}>
          Proposed:
        </Box>{" "}
        {proposal.title} · {proposal.summary}
      </Typography>
      <Box component="nav" aria-label="Files it changes" sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
        {files.map((f) => {
          const here = f.key === current;
          return (
            <FileLink
              key={f.key}
              to="/projects/$projectName/spec"
              params={{ projectName }}
              search={f.key === PRODUCT_KEY ? {} : { file: f.key }}
              aria-current={here ? "page" : undefined}
              sx={{
                fontSize: "0.75rem",
                px: 1,
                py: 0.25,
                borderRadius: 999,
                border: 1,
                borderColor: "info.main",
                color: here ? "info.contrastText" : "info.main",
                bgcolor: here ? "info.main" : "background.paper",
              }}
            >
              {f.label}
            </FileLink>
          );
        })}
      </Box>
      <Box sx={{ flex: 1 }} />
      <Box sx={{ display: "flex", gap: 0.75 }}>
        <Button
          size="small"
          variant="contained"
          color="info"
          disabled={pending !== null}
          onClick={() => void settle(proposal, "accept")}
        >
          Accept
        </Button>
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          disabled={pending !== null}
          onClick={() => void settle(proposal, "discard")}
          sx={{ bgcolor: "background.paper" }}
        >
          Discard
        </Button>
      </Box>
      {error && (
        <Typography role="alert" variant="body2" color="error" sx={{ flexBasis: "100%" }}>
          {error.message}. Try again.
        </Typography>
      )}
    </Box>
  );
}
