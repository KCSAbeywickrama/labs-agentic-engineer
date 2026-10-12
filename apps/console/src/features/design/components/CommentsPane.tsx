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
import { Box, Link, Typography } from "@wso2/oxygen-ui";
import type { DesignCard } from "../useDesignCard";
import { CommentThreads } from "./CommentThreads";
import { placeIn, threadActions } from "./ItemPane";

// The Comments item (D13): every comment on the design, grouped by the file
// it is on, in the rail's order, each group linking to its file. Comments are
// added from each file's 💬, and sent with Address comments on the Overview.
// A comment on a file the design no longer has keeps its group, by path.

const FileLink = createLink(Link);

export function CommentsPane({ projectName, card }: { projectName: string; card: DesignCard }) {
  const { review, items } = card;
  const actions = threadActions(card);
  const listed = new Set(items.map((i) => i.path));
  const groups = [
    ...items.flatMap((item) => {
      const comments = review.review.artifacts.find((a) => a.path === item.path)?.comments ?? [];
      return comments.length > 0 ? [{ path: item.path, item, comments }] : [];
    }),
    ...review.review.artifacts.flatMap((a) => (!listed.has(a.path) && a.comments?.length ? [{ path: a.path, item: null, comments: a.comments }] : [])),
  ];
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      <Box>
        <Typography component="h2" sx={{ fontSize: "1.25rem", fontWeight: 600 }}>
          Comments
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Every comment on the design, by file. Add one from a file's 💬; send them with Address comments on the Overview.
        </Typography>
      </Box>
      {groups.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No comments yet.
        </Typography>
      )}
      {groups.map((g) => (
        <Box key={g.path} component="section" aria-label={g.item?.title ?? g.path} sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
          <Box sx={{ display: "flex", gap: 1, alignItems: "baseline" }}>
            {g.item ? (
              <FileLink to="/projects/$projectName/design" params={{ projectName }} search={{ art: g.item.key }} variant="body2" sx={{ fontWeight: 600 }}>
                {g.item.title}
              </FileLink>
            ) : (
              <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: "monospace" }}>
                {g.path}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              {g.comments.length}
            </Typography>
          </Box>
          <CommentThreads comments={g.comments} actions={actions} {...(g.item ? { place: placeIn(card, g.item) } : {})} />
        </Box>
      ))}
    </Box>
  );
}
