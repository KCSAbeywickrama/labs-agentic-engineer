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

import { Box, Divider, Drawer, IconButton, Stack, Typography } from "@wso2/oxygen-ui";
import { X } from "@wso2/oxygen-ui-icons-react";
import type { components } from "../../../generated/aep-api";
import {
  ConfigKeysSection,
  ConsumersSection,
  DeleteResourceSection,
  OutputsSection,
  ParametersSection,
} from "./resource-inspect-sections";

type PlatformResourceTypeDTO = components["schemas"]["PlatformResourceTypeDTO"];
type ExternalResourceDTO = components["schemas"]["ExternalResourceDTO"];

export type ResourceDrawerProps = {
  open: boolean;
  onClose: () => void;
} & (
  | { kind: "platform"; resource: PlatformResourceTypeDTO }
  | { kind: "external"; resource: ExternalResourceDTO }
  | { kind: null; resource: null }
);

function ExternalResourceBody({
  resource,
  onClose,
}: {
  resource: ExternalResourceDTO;
  onClose: () => void;
}) {
  const config = resource.config ?? [];
  const consumers = resource.consumers ?? [];
  return (
    <Box sx={{ mt: 2 }}>
      <ConfigKeysSection config={config} />
      <ConsumersSection consumers={consumers} />
      <DeleteResourceSection resource={resource} consumers={consumers} onClose={onClose} />
    </Box>
  );
}

function PlatformResourceBody({ resource }: { resource: PlatformResourceTypeDTO }) {
  const parameters = resource.parameters ?? {};
  const outputs = resource.outputs ?? [];
  const consumers = resource.consumers ?? [];
  return (
    <Box sx={{ mt: 2 }}>
      <ParametersSection parameters={parameters} />
      <OutputsSection outputs={outputs} />
      <ConsumersSection consumers={consumers} />
    </Box>
  );
}

export function ResourceDrawer(props: ResourceDrawerProps) {
  const { resource, open, onClose } = props;
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      // Force an opaque surface — see BuildDependencyDrawer for why the
      // theme's default `background.paper` (semi-transparent) is unusable here.
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
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            {resource?.name}
          </Typography>
          <IconButton aria-label="Close" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </Stack>
        <Divider sx={{ mb: 2 }} />
        {resource?.description && (
          <Typography variant="body2" color="text.secondary">
            {resource.description}
          </Typography>
        )}
        {props.kind === "external" && (
          <ExternalResourceBody resource={props.resource} onClose={onClose} />
        )}
        {props.kind === "platform" && <PlatformResourceBody resource={props.resource} />}
      </Box>
    </Drawer>
  );
}
