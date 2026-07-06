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

import type { components } from "../../generated/aep-api";

type OrganizationList = components["schemas"]["OrganizationList"];

// "acme" matches the mock session's org so the switcher shows the signed-in
// org as current; the others exercise the disabled-entries state.
export const seedOrganizations: OrganizationList = {
  items: [
    {
      name: "acme",
      displayName: "Acme Inc",
      description: "Default development organization",
      uuid: "0f0e0d0c-0b0a-4908-8706-050403020100",
      createdAt: "2026-01-05T09:00:00Z",
      status: "active",
    },
    {
      name: "globex",
      displayName: "Globex Corporation",
      uuid: "1f1e1d1c-1b1a-4918-9716-151413121110",
      createdAt: "2026-02-11T14:30:00Z",
      status: "active",
    },
    {
      name: "initech",
      displayName: "Initech",
      uuid: "2f2e2d2c-2b2a-4928-a726-252423222120",
      createdAt: "2026-03-19T11:15:00Z",
      status: "active",
    },
  ],
};
