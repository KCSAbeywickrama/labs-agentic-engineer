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

export function splitLabel(statement: string): { body: string; label: string | undefined } {
  const index = statement.indexOf(":");
  if (index === -1) {
    return { body: statement.trim(), label: undefined };
  }

  const label = statement.slice(index + 1).trim();
  return {
    body: statement.slice(0, index).trim(),
    label: label.length > 0 ? label : undefined
  };
}
