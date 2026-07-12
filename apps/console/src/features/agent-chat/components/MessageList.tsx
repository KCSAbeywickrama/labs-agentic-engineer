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

import { Avatar, Box, Divider, Stack, Typography, alpha } from "@wso2/oxygen-ui";
import type { FeedBlock } from "../feed";
import { TurnBlock } from "./TurnBlock";
import { WorkingIndicator } from "./WorkingIndicator";

// The agent activity stream (task 3): a linear, author-attributed feed of user
// messages and the agent turns they trigger. No bubbles, no left/right
// alignment — every block is a full-width row.

function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function timeOf(createdAt: number | undefined): string | null {
  if (!createdAt) return null;
  return new Date(createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function UserBlock({ block }: { block: Extract<FeedBlock, { kind: "user" }> }) {
  const { message, attribution } = block;
  const time = timeOf(message.createdAt);
  const failed = message.status === "failed";
  return (
    <Box data-testid="user-message">
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
        <Avatar
          sx={{
            width: 22,
            height: 22,
            fontSize: "0.7rem",
            bgcolor: attribution.isOwn ? "primary.main" : "info.main",
          }}
        >
          {initialOf(attribution.displayName)}
        </Avatar>
        <Typography variant="caption" sx={{ fontWeight: 600 }}>
          {attribution.displayName}
        </Typography>
        {time && (
          <Typography variant="caption" color="text.secondary">
            {time}
          </Typography>
        )}
      </Stack>
      {/* Human messages get a subtle bubble so a person's words read as
          distinct turns in the thread (own vs teammate tinted differently);
          agent turns stay bubble-less as a flat activity stream. */}
      <Box
        sx={{
          display: "inline-block",
          maxWidth: "100%",
          px: 1.5,
          py: 1,
          borderRadius: 2,
          bgcolor: (theme) =>
            attribution.isOwn
              ? alpha(theme.palette.primary.main, 0.08)
              : theme.palette.action.hover,
        }}
      >
        <Typography
          sx={{
            whiteSpace: "pre-wrap",
            fontSize: "0.875rem",
            color: "text.primary",
            opacity: failed ? 0.6 : 1,
          }}
        >
          {message.content}
        </Typography>
      </Box>
    </Box>
  );
}

export function MessageList({
  feed,
  expandedGroups,
  onToggleGroup,
  onOpenSpec,
  showWorkingTail,
}: {
  feed: FeedBlock[];
  expandedGroups: Set<string>;
  onToggleGroup: (id: string) => void;
  onOpenSpec: () => void;
  /** Show a tail "Working…" indicator when a turn is in flight but hasn't
   *  produced any content (and so has no running turn block of its own yet). */
  showWorkingTail: boolean;
}) {
  return (
    <Stack divider={<Divider flexItem />} spacing={2}>
      {feed.map((block) =>
        block.kind === "user" ? (
          <UserBlock key={block.id} block={block} />
        ) : (
          <TurnBlock
            key={block.id}
            turn={block}
            expandedGroups={expandedGroups}
            onToggleGroup={onToggleGroup}
            onOpenSpec={onOpenSpec}
          />
        ),
      )}
      {showWorkingTail && <WorkingIndicator />}
    </Stack>
  );
}
