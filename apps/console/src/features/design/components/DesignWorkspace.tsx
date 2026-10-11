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
import { useNavigate } from "@tanstack/react-router";
import { Box, Button, Skeleton, Typography } from "@wso2/oxygen-ui";
import { EmptyState } from "../../../components/EmptyState";
import { BuildButton } from "../../builds/components/BuildButton";
import { PrototypeReviewHost } from "../../prototype/components/PrototypeReviewHost";
import { useChatPanel } from "../../shell/chatPanel";
import { PHONE } from "../../shell/layout";
import { useSpecWorkspace } from "../../spec/useSpecWorkspace";
import { openPane } from "../model/artifacts";
import { useDesignCard } from "../useDesignCard";
import { useDesignModel } from "../useDesignModel";
import { useDesignTurns } from "../useDesignTurns";
import { CommentsPane } from "./CommentsPane";
import { DependencyView } from "./DependencyView";
import { DesignOverview } from "./DesignOverview";
import { DesignPicker, DesignRail } from "./DesignRail";
import { ItemPane } from "./ItemPane";

// The Design card (L21–L25): the rail of the design's files, and the open
// pane: the Overview, every comment, one file under its title line (Checked
// and 💬), or a dependency that blocks a build. A prototype's full-screen
// review opens over it (`?review=<component>`).

function names(ids: string[], name: (id: string) => string): string {
  const list = ids.map(name);
  return list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

function Note({ children }: { children: ReactNode }) {
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
        gap: 1.25,
        fontSize: "0.875rem",
      }}
    >
      {children}
    </Box>
  );
}

/** The design card's header: Build alone, in the same state as the Overview's, once something is designed. */
export function DesignActions({ projectName }: { projectName: string }) {
  const card = useDesignCard(projectName);
  if (card.items.length === 0) return null;
  return <BuildButton projectName={projectName} size="small" variant={card.primary?.kind === "build" ? "contained" : "outlined"} />;
}

/**
 * The design card's body. Before anything is designed it says what design
 * takes and offers it; then it is the rail and the open pane.
 */
export function DesignWorkspace({ projectName, art, review }: { projectName: string; art?: string | undefined; review?: string | undefined }) {
  const design = useDesignModel(projectName);
  const { model: spec, workspace } = useSpecWorkspace(projectName);
  const card = useDesignCard(projectName);
  const turns = useDesignTurns(projectName);
  const navigate = useNavigate();
  const chatPanel = useChatPanel();

  if (design.isError || spec.isError) {
    const retry = () => void (design.isError ? design.refetch() : spec.refetch());
    return (
      <Box sx={{ p: 3.5 }}>
        <EmptyState
          title="Couldn't open the design"
          description={(design.error ?? spec.error)?.message ?? ""}
          action={
            <Button variant="outlined" onClick={retry}>
              Try again
            </Button>
          }
        />
      </Box>
    );
  }

  const scrollSx = { flex: 1, minWidth: 0, overflowY: "auto", px: 3.5, pt: 3, pb: 11, [PHONE]: { px: 2, pb: 17.5 } } as const;
  if (!design.data || !spec.data || !workspace) {
    return (
      <Box sx={scrollSx} aria-busy>
        <Skeleton width={180} />
        <Skeleton variant="text" sx={{ fontSize: "1.5rem" }} width={260} />
        <Skeleton variant="rounded" height={160} sx={{ mt: 2 }} />
      </Box>
    );
  }

  const model = design.data;
  const features = spec.data.features;
  const featureName = (id: string) => features.find((f) => f.id === id)?.name ?? id;
  const label = workspace.design.label;

  if (card.items.length === 0) {
    return (
      <Box sx={scrollSx}>
        <Note>
          {model.running?.kind === "design" ? (
            <Typography variant="body2">
              Designing {names(model.running.features, featureName)}. Each file shows here as it lands; follow along in the chat.
            </Typography>
          ) : (
            <>
              <Typography variant="body2">
                Nothing is designed yet. Design takes every interviewed feature, including lines still marked assumed, and makes everything Build needs, in
                order: the architecture, the data model, roles and permissions, each component&apos;s prototype or contract, the dependencies, the technical
                decisions and the acceptance tests.
              </Typography>
              {label ? (
                <Button size="small" variant="contained" disabled={!turns.ready} onClick={() => turns.design()}>
                  {label}
                </Button>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Interview a feature first.
                </Typography>
              )}
            </>
          )}
        </Note>
      </Box>
    );
  }

  const pane = openPane(card.items, card.blocking, art);
  const current = pane.kind === "overview" ? undefined : pane.kind === "comments" ? "comments" : art;
  const open = review ? card.prototypes.get(review) : undefined;
  const closeReview = () => void navigate({ to: "/projects/$projectName/design", params: { projectName }, search: art ? { art } : {} });
  const outOfDate = workspace.design.outOfDate;

  return (
    <Box sx={{ display: "flex", height: "100%", minHeight: 0 }}>
      <DesignRail projectName={projectName} card={card} current={current} />
      <Box sx={scrollSx}>
        <Box sx={{ maxWidth: 960, display: "flex", flexDirection: "column", gap: 2.5 }}>
          <DesignPicker projectName={projectName} card={card} current={current} />
          {model.running && (
            <Typography variant="body2" color="primary.main">
              {model.running.kind === "design"
                ? `Updating the design for ${names(model.running.features, featureName)}. Each file changes here as it lands; follow along in the chat.`
                : "Working through your comments. Each file changes here as it lands; follow along in the chat."}
            </Typography>
          )}
          {pane.kind === "overview" && (
            <>
              <Box>
                <Typography component="h2" sx={{ fontSize: "1.25rem", fontWeight: 600 }}>
                  Design
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {features.length} features · {card.items.length} files
                </Typography>
              </Box>
              {label && !model.running && (
                <Note>
                  <Typography variant="body2">
                    {outOfDate.length > 0
                      ? `You changed ${names(outOfDate, featureName)} in Spec since it was designed.`
                      : `${names(workspace.design.toDesign, featureName)} ${workspace.design.toDesign.length === 1 ? "isn't" : "aren't"} designed yet.`}
                  </Typography>
                  <Button size="small" variant={card.primary?.kind === "design" ? "contained" : "outlined"} disabled={!turns.ready} onClick={() => turns.design()}>
                    {label}
                  </Button>
                </Note>
              )}
              <DesignOverview
                projectName={projectName}
                card={card}
                featureName={featureName}
                ready={turns.ready}
                running={model.running !== null}
                onAddress={() => void turns.addressComments(card.review)}
              />
            </>
          )}
          {pane.kind === "comments" && <CommentsPane projectName={projectName} card={card} />}
          {pane.kind === "item" && (
            <ItemPane
              key={pane.item.key}
              projectName={projectName}
              card={card}
              item={pane.item}
              primary={card.primary?.kind === "open" && card.primary.key === pane.item.key}
              featureName={featureName}
              onReview={(component) => void navigate({ to: "/projects/$projectName/design", params: { projectName }, search: { art: pane.item.key, review: component } })}
            />
          )}
          {pane.kind === "blocking" && (
            <DependencyView projectName={projectName} dependency={pane.dependency} featureName={featureName(pane.dependency.featureId)} />
          )}
        </Box>
      </Box>
      {open && (
        <PrototypeReviewHost
          prototype={open}
          review={card.review}
          reviews={card.reviews}
          onWhatChanged={() => {
            closeReview();
            chatPanel.open();
          }}
          onClose={closeReview}
        />
      )}
    </Box>
  );
}
