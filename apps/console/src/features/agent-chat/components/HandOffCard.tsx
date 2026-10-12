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
import { Box, Button, Link, Typography } from "@wso2/oxygen-ui";
import { areaLabel } from "@aep/agent-stream";
import { useChatPanel } from "../../shell/chatPanel";
import type { HandOffItem } from "../chatLog";
import { areaRequest, continueInArea, getHandOff, setHandOff, type HandOffState } from "../handOffState";
import { useOpenAreaChat } from "../useOpenIssuesChat";
import { chatStoreFor, useProjectChat } from "../useProjectChat";

/** How much of the request the card shows before Open <area> is chosen. */
const PREVIEW_CHARS = 200;

function preview(request: string): string {
  const words = request.trim();
  return words.length > PREVIEW_CHARS ? `${words.slice(0, PREVIEW_CHARS)}…` : words;
}

/**
 * The main chat's announcement that a request belongs in an area (Issues).
 * Open <area> opens the area's page, whose chat takes the chat panel, and
 * takes the request on to it as the area's command (`continueInArea`); Stay
 * here keeps the user where they are, and nothing is sent. Once chosen, the
 * card reads as what was chosen, here and after a reload.
 */
export function HandOffCard({ projectName, item }: { projectName: string; item: HandOffItem }) {
  const [chosen, setChosen] = useState<HandOffState>(() => getHandOff(projectName, item.toolCallId));
  const choose = (next: HandOffState) => {
    setHandOff(projectName, item.toolCallId, next);
    setChosen(next);
  };
  const openArea = useOpenAreaChat(projectName);
  const openAreaChat = () => openArea(item.area);
  const label = areaLabel(item.area);

  if (chosen === "stayed") {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ pl: 4 }}>
        {`Stayed here instead of opening ${label}`}
      </Typography>
    );
  }
  if (chosen === "continued") return <Continued label={label} onOpen={() => void openAreaChat()} />;
  return <Pending projectName={projectName} item={item} openAreaChat={openAreaChat} choose={choose} />;
}

function Continued({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <Typography variant="caption" color="text.secondary" sx={{ pl: 4 }}>
      {`Continued in ${label} · `}
      <Link component="button" type="button" variant="caption" onClick={onOpen} sx={{ verticalAlign: "baseline" }}>
        Open
      </Link>
    </Typography>
  );
}

/**
 * The choice still to make. Only an undecided card watches the area's chat:
 * once its thread carries the request, it went on from somewhere (a
 * teammate, another tab) and the card reads as continued.
 */
function Pending({
  projectName,
  item,
  openAreaChat,
  choose,
}: {
  projectName: string;
  item: HandOffItem;
  openAreaChat: () => Promise<void>;
  choose: (next: HandOffState) => void;
}) {
  const chatPanel = useChatPanel();
  const areaChat = useProjectChat(projectName, item.area);
  const [moving, setMoving] = useState(false);
  const label = areaLabel(item.area);
  const message = areaRequest(item.area, item.request);
  if (areaChat.items.some((i) => i.kind === "user" && i.text.trim() === message.trim())) {
    return <Continued label={label} onOpen={() => void openAreaChat()} />;
  }

  const open = async () => {
    setMoving(true);
    try {
      // The area's chat takes the panel, so the request is seen
      // going there (sent, or waiting in its composer).
      await openAreaChat();
    } catch {
      // The move did not happen: nothing was sent, and the choice is offered again.
      setMoving(false);
      return;
    }
    choose("continued");
    chatPanel.open();
    await continueInArea(projectName, item.area, item.request, {
      store: chatStoreFor(item.area),
      compose: (text) => chatPanel.compose(text, { view: item.area, projectName }),
    });
  };

  return (
    <Box sx={{ pl: 4, display: "flex", flexDirection: "column", gap: 0.75 }}>
      <Typography variant="body2">
        This belongs in <strong>{label}</strong>.
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {`I'll pass on: “${preview(item.request)}”`}
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
        <Button size="small" variant="contained" disabled={moving} onClick={() => void open()}>
          {`Open ${label}`}
        </Button>
        <Button size="small" variant="outlined" disabled={moving} onClick={() => choose("stayed")}>
          Stay here
        </Button>
      </Box>
    </Box>
  );
}
