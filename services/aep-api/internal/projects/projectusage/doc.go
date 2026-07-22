// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

// Package projectusage serves the org-wide per-project agent-usage read for
// the console's Settings → Usage page (#291).
//
// Triggers: list-project-usage.
// Ports:    none yet — the op answers an empty card list until the #299
// capture and write-time-stamping backend lands (no usage IS the truth
// today: nothing is captured, and the console renders its empty state).
package projectusage
