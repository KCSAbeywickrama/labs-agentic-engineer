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

import { useEffect } from "react";
import { chatStore } from "../agent-chat/useProjectChat";
import { prototypeNote } from "./model/note";

/**
 * Post the chat's Open prototype line when a `/prototype` turn completes, from
 * wherever the user is in the project. Mounted once, in the shell, so a turn
 * that ends with the chat closed still leaves its note.
 */
export function usePrototypeNotes(): void {
  useEffect(
    () =>
      chatStore.onTurnEnd((projectName, outcome, instruction) => {
        const note = outcome === "completed" ? prototypeNote(instruction) : null;
        if (note) chatStore.post(projectName, note.text, note.actions);
      }),
    [],
  );
}
