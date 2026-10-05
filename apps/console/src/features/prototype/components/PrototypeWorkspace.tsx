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
import { Box, Button, Chip, CircularProgress, Skeleton, Tooltip, Typography } from "@wso2/oxygen-ui";
import { AppWindow } from "@wso2/oxygen-ui-icons-react";
import { PHONE } from "../../shell/layout";
import type { ReviewQueue } from "../model/feedback";
import { markReviewed } from "../model/reviewed";
import type { AppPrototype, PrototypeStatus } from "../model/prototypes";
import { usePrototypes } from "../usePrototypes";
import { usePrototypeTurns } from "../usePrototypeTurns";
import { MakePrototypeButton } from "./MakePrototypeButton";
import { PrototypeReview } from "./PrototypeReview";

const STATUS: Record<PrototypeStatus, { label: string; color: "default" | "success" | "error" | "info" }> = {
  none: { label: "No prototype", color: "default" },
  ready: { label: "Ready", color: "success" },
  invalid: { label: "Invalid", color: "error" },
  revising: { label: "Revising…", color: "info" },
};

function Row({ prototype, ready, onReview, onMake }: { prototype: AppPrototype; ready: boolean; onReview: () => void; onMake: () => void }) {
  const busy = prototype.status === "revising";
  // The first make: nothing to name, review or update yet.
  const making = busy && !prototype.exists;
  const status = making ? { ...STATUS.revising, label: "Making prototype…" } : STATUS[prototype.status];
  const name = prototype.files?.manifest.name;
  return (
    <Box component="li" sx={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 1 }}>
      <Box
        sx={{
          width: 56,
          height: 56,
          mb: 0.75,
          borderRadius: 3,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "action.hover",
          color: "primary.main",
        }}
      >
        {busy ? <CircularProgress size={26} aria-label="Working on the prototype" /> : <AppWindow size={26} aria-hidden />}
      </Box>
      <Typography component="h3" sx={{ fontWeight: 600, fontSize: "1.375rem" }}>
        {name ?? prototype.component}
      </Typography>
      {name && (
        <Typography variant="body2" color="text.secondary" sx={{ fontFamily: "monospace" }}>
          {prototype.component}
        </Typography>
      )}
      <Chip size="small" label={status.label} color={status.color} variant={prototype.status === "none" ? "outlined" : "filled"} />
      {prototype.problem && (
        <Tooltip title={prototype.problem}>
          <Typography variant="body2" color="error.main">
            The last prototype couldn't be rendered.
          </Typography>
        </Tooltip>
      )}
      {making ? (
        <Typography variant="body2" color="text.secondary">
          This usually takes a few minutes.
        </Typography>
      ) : (
        <Box sx={{ mt: 2 }}>
          {prototype.files ? (
            <Button variant="contained" onClick={onReview}>
              Review
            </Button>
          ) : (
            <Button variant="contained" disabled={!ready} onClick={onMake}>
              {prototype.status === "invalid" ? "Try again" : "Make prototype"}
            </Button>
          )}
        </Box>
      )}
    </Box>
  );
}

/**
 * The Prototype tab: each web application the design has, with its
 * prototype's status, Review (the full-screen overlay) and Make or Update.
 * Before any prototype exists it says what one takes, with Make prototype
 * when the design has a web application. The open review is the route's
 * (`?review=<component>`); the requests queued in a review are kept here, so
 * closing and opening it again keeps them.
 */
export function PrototypeWorkspace({
  projectName,
  review,
  onReview,
}: {
  projectName: string;
  review: string | undefined;
  onReview: (component: string | null) => void;
}) {
  const prototypes = usePrototypes(projectName);
  const turns = usePrototypeTurns(projectName);
  const [queues, setQueues] = useState<Record<string, ReviewQueue | null>>({});

  if (!prototypes) {
    return (
      <Box aria-busy sx={{ px: 3.5, pt: 3 }}>
        <Skeleton width={180} />
        <Skeleton variant="rounded" height={72} sx={{ mt: 2 }} />
      </Box>
    );
  }

  const open = review ? prototypes.find((p) => p.component === review) : undefined;
  const none = prototypes.every((p) => p.status === "none");

  return (
    <Box
      sx={{
        height: "100%",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        px: 3.5,
        py: 4,
        [PHONE]: { px: 2 },
      }}
    >
      {prototypes.length === 0 || none ? (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 1, maxWidth: "52ch" }}>
          <Box
            sx={{
              width: 56,
              height: 56,
              mb: 0.75,
              borderRadius: 3,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "action.hover",
              color: "text.secondary",
            }}
          >
            <AppWindow size={26} aria-hidden />
          </Box>
          <Typography component="h3" sx={{ fontWeight: 600, fontSize: "1.375rem" }}>
            No prototype yet
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {prototypes.length === 0
              ? "Finish the spec and design a web application first. Its clickable prototype is made here."
              : "Make a clickable prototype of the designed web application to try it before anything is built."}
          </Typography>
          {prototypes.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <MakePrototypeButton projectName={projectName} variant="contained" />
            </Box>
          )}
        </Box>
      ) : (
        <Box component="ul" aria-label="Prototypes" sx={{ m: "auto", p: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
          {prototypes.map((p) => (
            <Row
              key={p.component}
              prototype={p}
              ready={turns.ready}
              onReview={() => onReview(p.component)}
              onMake={() => turns.make(p.component)}
            />
          ))}
        </Box>
      )}
      {open && (
        <PrototypeReview
          prototype={open}
          queue={queues[open.component] ?? null}
          onQueue={(queue) => setQueues((q) => ({ ...q, [open.component]: queue }))}
          ready={turns.ready}
          onSend={turns.sendFeedback}
          onSeen={(hash) => markReviewed(projectName, open.component, hash)}
          onClose={() => onReview(null)}
        />
      )}
    </Box>
  );
}
