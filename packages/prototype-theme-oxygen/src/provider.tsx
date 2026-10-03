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
 * The theme's root: Oxygen's base theme with sentence-case buttons (as the
 * console writes them), pinned to light with no stored colour scheme (the
 * frame has no storage) so a prototype draws the same in every frame and in
 * the render check. Emotion injects every style inline and Oxygen ships its
 * Inter font as data URIs, so the frame loads nothing.
 */

import { Box, createOxygenTheme, CssBaseline, ThemeProvider } from "@wso2/oxygen-ui";
import type { ReactNode } from "react";

const oxygenTheme = createOxygenTheme({
  components: {
    MuiButton: { styleOverrides: { root: { textTransform: "none" } } },
  },
});

export function OxygenProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={oxygenTheme} defaultMode="light" storageManager={null}>
      <CssBaseline />
      <Box
        sx={{
          // The kit's Annotate outline and label, in Oxygen's primary.
          "--proto-select": oxygenTheme.vars.palette.primary.main,
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          height: "100%",
          bgcolor: "background.default",
          color: "text.primary",
        }}
      >
        {children}
      </Box>
    </ThemeProvider>
  );
}
