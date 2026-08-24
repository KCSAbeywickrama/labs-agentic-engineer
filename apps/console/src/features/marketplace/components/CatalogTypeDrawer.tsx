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

import { Box, Drawer, IconButton, Stack, Typography } from "@wso2/oxygen-ui";
import { X } from "@wso2/oxygen-ui-icons-react";
import type { components } from "../../../generated/aep-api";

type PlatformResourceTypeDTO = components["schemas"]["PlatformResourceTypeDTO"];
type ExternalResourceDTO = components["schemas"]["ExternalResourceDTO"];

// Discriminated on `kind` so Task 6 can narrow `resource` when it fills the
// body. `kind: null` is the resting state — the drawer still mounts (so its
// close transition can animate) but has nothing to show.
export type CatalogTypeDrawerProps = {
  open: boolean;
  onClose: () => void;
} & (
  | { kind: "platform"; resource: PlatformResourceTypeDTO }
  | { kind: "external"; resource: ExternalResourceDTO }
  | { kind: null; resource: null }
);

// Shell only (name + close). Task 6 replaces this with the catalog-type body.
export function CatalogTypeDrawer(props: CatalogTypeDrawerProps) {
  const { resource, open, onClose } = props;
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      // Force an opaque surface — see ResourceDrawer / BuildDependencyDrawer
      // for why the theme's default `background.paper` is unusable here.
      slotProps={{
        paper: {
          sx: {
            bgcolor: "background.default",
            backgroundImage: "none",
            backdropFilter: "none",
          },
        },
      }}
    >
      <Box sx={{ width: 440, p: 3 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            {resource?.name}
          </Typography>
          <IconButton aria-label="Close" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </Stack>
      </Box>
    </Drawer>
  );
}
