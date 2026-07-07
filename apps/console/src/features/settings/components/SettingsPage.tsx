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
import {
  Box,
  Card,
  CardContent,
  PageContent,
  PageTitle,
  Tab,
  Tabs,
  useMediaQuery,
  useTheme,
} from "@wso2/oxygen-ui";
import { KeyRound, Puzzle } from "@wso2/oxygen-ui-icons-react";
import { CredentialsSection } from "./CredentialsSection";
import { SkillsSection } from "./SkillsSection";

// v1 note (issue #96): no role gate here — any authenticated org member who
// reaches /settings gets full access. Architect/SRE is the intended owner,
// not an enforced restriction (no server-side RBAC on /config or /skills*
// today, and no reliable client-side role signal either).
export function SettingsPage() {
  const [tab, setTab] = useState(0);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  return (
    <PageContent>
      <PageTitle>
        <PageTitle.Header>Settings</PageTitle.Header>
        <PageTitle.SubHeader>
          Org-level GitHub and Anthropic credentials, and the skills catalogue
        </PageTitle.SubHeader>
      </PageTitle>

      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          gap: 3,
        }}
      >
        <Card
          variant="outlined"
          sx={{ width: { xs: "100%", sm: 220 }, height: "fit-content" }}
        >
          <CardContent sx={{ p: 2 }}>
            <Tabs
              orientation={isMobile ? "horizontal" : "vertical"}
              variant={isMobile ? "fullWidth" : "standard"}
              value={tab}
              onChange={(_, v) => setTab(v)}
            >
              <Tab
                icon={<KeyRound size={18} />}
                iconPosition="start"
                label="Credentials"
              />
              <Tab
                icon={<Puzzle size={18} />}
                iconPosition="start"
                label="Skills"
              />
            </Tabs>
          </CardContent>
        </Card>

        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          {tab === 0 && <CredentialsSection />}
          {tab === 1 && <SkillsSection />}
        </Box>
      </Box>
    </PageContent>
  );
}
