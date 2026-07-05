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
import { Box, Button, Typography } from "@wso2/oxygen-ui";
import { ArrowLeft } from "@wso2/oxygen-ui-icons-react";
import { createLink } from "@tanstack/react-router";

// Router-aware Button: renders an anchor with proper href + SPA navigation.
const LinkButton = createLink(Button);

// Consistent "coming soon" frame for the Spec / Builds / Deployments pages
// (issue #77 ships them as navigation targets; each is its own feature).
export function SectionPlaceholder({
  icon,
  title,
  description,
  projectName,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  projectName: string;
}) {
  return (
    <Box sx={{ textAlign: "center", py: 10 }}>
      <Box sx={{ opacity: 0.3, mb: 2 }}>{icon}</Box>
      <Typography variant="h6" gutterBottom>
        {title}
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ maxWidth: 480, mx: "auto", mb: 3 }}
      >
        {description}
      </Typography>
      <LinkButton
        startIcon={<ArrowLeft size={18} />}
        to="/projects/$projectName"
        params={{ projectName }}
      >
        Back to overview
      </LinkButton>
    </Box>
  );
}
