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

/** "10 Jul, 14:43" — the stamp the builds surfaces share. */
export function runStamp(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/**
 * How long a run took, or has been going.
 *
 * `to` omitted means "still running", measured against now. The runs query
 * polls while a version is live, so this re-renders on its own and needs no
 * timer of its own — a settled run's span never changes anyway.
 */
export function runDuration(
  fromIso: string | null | undefined,
  toIso?: string | null,
): string {
  if (!fromIso) return "";
  const from = new Date(fromIso).getTime();
  const to = toIso ? new Date(toIso).getTime() : Date.now();
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return "";

  const minutes = Math.round((to - from) / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const spareMinutes = minutes % 60;
  if (hours < 24) {
    return spareMinutes === 0 ? `${hours}h` : `${hours}h ${spareMinutes}m`;
  }

  const days = Math.floor(hours / 24);
  const spareHours = hours % 24;
  return spareHours === 0 ? `${days}d` : `${days}d ${spareHours}h`;
}
