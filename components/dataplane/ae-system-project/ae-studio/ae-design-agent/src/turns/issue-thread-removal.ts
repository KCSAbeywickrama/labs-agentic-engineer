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
 * The one way an issue chat's thread is removed once its issue closed or
 * reopened: the Turn socket's DELETE (aep-api told of the event) and the
 * start path finding the issue closed (`TurnStarter.checkIssueOpen`) both go
 * through here, so neither drops a thread under its running turn.
 */

import { chatKey, issueChat } from "../conversations/chat.js";
import type { ThreadBook } from "../conversations/thread-book.js";
import type { TurnDesk } from "./turn-desk.js";

export interface IssueThreadRemovalDeps {
  desk: Pick<TurnDesk, "active">;
  threads: Pick<ThreadBook, "deferIssueRemoval" | "removeIssueThread">;
}

/**
 * Remove issue `issueNumber`'s chat thread of `project`, bounded by `before`:
 * now when no turn runs on it, else when that turn ends, so the turn's save
 * never brings the thread back (nor leaves its messages behind). Idempotent.
 */
export async function removeIssueThread(deps: IssueThreadRemovalDeps, project: string, issueNumber: number, before: Date): Promise<void> {
  const active = deps.desk.active({ kind: "project", project, chat: chatKey(issueChat(issueNumber)) });
  if (active) deps.threads.deferIssueRemoval(project, issueNumber, active.conversationId, before);
  else await deps.threads.removeIssueThread(project, issueNumber, before);
}
