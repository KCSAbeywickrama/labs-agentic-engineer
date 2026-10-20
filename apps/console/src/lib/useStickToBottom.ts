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

import { useCallback, useEffect, useRef, useState } from "react";

/** How near the end still counts as at it: sub-pixel layout rarely lands exactly on it. */
const AT_BOTTOM_PX = 24;

export interface StickToBottom {
  /** The scroll container's ref. */
  ref: (node: HTMLElement | null) => void;
  /** Whether the reader is at the bottom, so new rows keep them there. */
  following: boolean;
  /** Back to the bottom, and following again. */
  jump: () => void;
}

/**
 * Follow a growing list as a chat or a terminal does: while the reader is at
 * the bottom, new rows (and rows that grow) keep it there; once they scroll up
 * to read, it stays put until they scroll back down or `jump`. A new container
 * starts at the bottom.
 */
export function useStickToBottom(): StickToBottom {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [following, setFollowing] = useState(true);
  // Read by the observers, which must not wait for a render to learn it.
  const atBottom = useRef(true);
  useEffect(() => {
    if (!node) return;
    atBottom.current = true;
    setFollowing(true);
    const onScroll = () => {
      atBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < AT_BOTTOM_PX;
      setFollowing(atBottom.current);
    };
    const follow = () => {
      if (atBottom.current) node.scrollTop = node.scrollHeight;
    };
    follow();
    node.addEventListener("scroll", onScroll);
    const resized = new ResizeObserver(follow);
    const added = new MutationObserver(() => {
      follow();
      for (const child of node.children) resized.observe(child);
    });
    for (const child of node.children) resized.observe(child);
    added.observe(node, { childList: true, subtree: true, characterData: true });
    return () => {
      node.removeEventListener("scroll", onScroll);
      resized.disconnect();
      added.disconnect();
    };
  }, [node]);
  const jump = useCallback(() => {
    atBottom.current = true;
    setFollowing(true);
    if (node) node.scrollTop = node.scrollHeight;
  }, [node]);
  return { ref: setNode, following, jump };
}
