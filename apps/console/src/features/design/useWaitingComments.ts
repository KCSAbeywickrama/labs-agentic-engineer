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

import { useMemo } from "react";
import { DESIGN_REVIEW_PATH } from "@aep/agent-stream";
import { useSpecDoc } from "../spec/collab/specDoc";
import { useRoomFiles } from "../spec/collab/useRoomFiles";
import { readReview, waitingComments } from "./model/review";

const REVIEW_FILE = [DESIGN_REVIEW_PATH] as const;

/** How many design comments wait for Address comments, read live from the room's review.json. */
export function useWaitingComments(projectName: string): number {
  const text = useRoomFiles(useSpecDoc(projectName), REVIEW_FILE)[DESIGN_REVIEW_PATH];
  return useMemo(() => waitingComments(readReview(text).review).length, [text]);
}
