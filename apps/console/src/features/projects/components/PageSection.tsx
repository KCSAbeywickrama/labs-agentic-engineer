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
import { Box, Card, Stack, Typography } from "@wso2/oxygen-ui";

/**
 * One numbered section of the environment page (the approved design, §6):
 * a bordered card whose head carries the section's NAME, a caption saying
 * what the section is for, and the section's place in the page's reading
 * order at the far right.
 *
 * The number is decorative — it repeats the order the reader already has from
 * the document itself — so it is `aria-hidden` rather than read out before
 * every heading. The heading is a real `h3`: the page title is the page's
 * only `h1`-level thing, and these four are its sections.
 */
export function PageSection({
  title,
  caption,
  index,
  flush = false,
  children,
}: {
  title: string;
  /** What this section is for, in the head beside the name. */
  caption?: ReactNode;
  /** "01" … "04" — the section's place in the page, shown small and grey. */
  index: string;
  /** The body brings its own padding (a table runs edge to edge). */
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <Card variant="outlined" component="section" aria-label={title}>
      <Stack
        direction="row"
        spacing={1.25}
        sx={{
          alignItems: "baseline",
          px: 2.25,
          py: 1.5,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Typography component="h3" variant="subtitle2" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        {caption && (
          <Typography variant="caption" color="text.secondary">
            {caption}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        <Typography
          aria-hidden
          variant="caption"
          sx={{ color: "text.disabled", fontWeight: 700, letterSpacing: "0.1em" }}
        >
          {index}
        </Typography>
      </Stack>
      <Box sx={flush ? undefined : { p: 2 }}>{children}</Box>
    </Card>
  );
}
