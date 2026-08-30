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
import { Box, Button, Chip, Paper, Stack, TextField, Tooltip } from "@wso2/oxygen-ui";
import { Crosshair } from "@wso2/oxygen-ui-icons-react";
import type { Editor } from "@tiptap/react";
import { docBlocks } from "./docBlocks";
import { anchorFor, type Anchor } from "../lib/anchor";
import { setAimHighlight } from "./aimHighlightPlugin";

// Aiming the agent at part of a markdown document (#666).
//
// The rule this component exists to keep is console ADR-0023: a SELECTION MAY
// ONLY OFFER. Selecting text puts a chip on screen and nothing else — no box
// opens, no focus moves, the caret is untouched and the range is never cleared.
// The document is a real editor, and drag-select is overwhelmingly how a person
// retypes, deletes or copies; an input that claimed the keyboard on selection
// would make all three impossible.
//
// The box opens on an EXPLICIT act — the chip, or ⌘K — and only then takes
// focus.
//
// Positioning is computed from `coordsAtPos` rather than delegated to Tiptap's
// BubbleMenu (used above for agent-suggestion review). BubbleMenu hides itself
// when the editor loses focus, which is exactly what opening our box does.

/** What the editor needs to let a selection reach the agent. */
export interface SpecAimBinding {
  /** The document being edited — the anchor's `file`. */
  path: string;
  /**
   * Dispatch. `change` rewrites the selection in place and leaves the chat
   * panel shut; `discuss` opens the same selection as a grilling.
   */
  send: (instruction: string, anchor: Anchor, intent: "change" | "discuss") => Promise<boolean>;
  /** Why a send would be refused right now — an agent already holds the turn —
   *  or `""` when it is live. Doubles as the disabled tooltip. */
  busyReason: string;
}

interface Placement {
  top: number;
  left: number;
}

/**
 * Where the floating surface sits: under the END of the selection, clamped into
 * the editor's own box so a selection at the right edge stays reachable.
 *
 * The end, not the start: anchored at the start the box lands ON the passage it
 * is about, hiding the text the user is writing an instruction for — which
 * defeats the wash it sits beside. The end is also where the mouse let go.
 */
function placementFor(editor: Editor, host: HTMLElement): Placement | null {
  const { to } = editor.state.selection;
  let coords: { top: number; bottom: number; left: number };
  try {
    coords = editor.view.coordsAtPos(to);
  } catch {
    // The position no longer resolves — an agent rewrote the document out from
    // under a stale selection. Nothing to point at.
    return null;
  }
  const box = host.getBoundingClientRect();
  return {
    top: coords.bottom - box.top + 6,
    left: Math.min(Math.max(coords.left - box.left, 8), Math.max(box.width - 320, 8)),
  };
}

export function SpecAimMenu({
  editor,
  aim,
}: {
  editor: Editor;
  aim: SpecAimBinding;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [hasRange, setHasRange] = useState(false);
  // The aimed range as two NUMBERS, not an object. The wash is painted by
  // dispatching a transaction, and a transaction re-runs `measure` — so an
  // effect keyed on a freshly-built object would paint, re-measure, rebuild the
  // object, and paint again forever. Numbers settle on the second pass.
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(0);

  // Re-measured on every transaction, so the surface follows the text it points
  // at while an agent streams into the same document. Positions are held LIVE
  // (ProseMirror maps them through every edit) and only become an anchor at
  // send — see `handleSend`.
  const measure = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const selection = editor.state.selection;
    setHasRange(!selection.empty);
    setFrom(selection.from);
    setTo(selection.to);
    setPlacement(placementFor(editor, host));
  }, [editor]);

  useEffect(() => {
    measure();
    editor.on("transaction", measure);
    return () => {
      editor.off("transaction", measure);
    };
  }, [editor, measure]);

  // The wash follows whatever is aimed at. It has to survive the box taking
  // focus: the browser stops painting the native selection the moment the
  // editor loses it, so without this the user is typing an instruction about a
  // passage they can no longer see.
  useEffect(() => {
    setAimHighlight(editor.view, hasRange || open ? { from, to } : null);
  }, [editor, hasRange, open, from, to]);

  // Scrolling moves the text without changing the document, so the transaction
  // hook above never fires for it.
  useEffect(() => {
    const scroller = editor.view.dom.closest("[data-aim-scroll]");
    if (!scroller) return;
    scroller.addEventListener("scroll", measure, { passive: true });
    return () => scroller.removeEventListener("scroll", measure);
  }, [editor, measure]);

  // ⌘K / Ctrl-K opens the box on whatever is selected — or, with a bare caret,
  // on the block it sits in, which is what "aim at this" means when nothing is
  // dragged.
  useEffect(() => {
    const dom = editor.view.dom;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "k" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      setOpen(true);
    };
    dom.addEventListener("keydown", onKeyDown);
    return () => dom.removeEventListener("keydown", onKeyDown);
  }, [editor]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setText("");
    // The caret stays exactly where it was. Dropping the selection because a
    // suggestion was waved away would be the editor losing the user's place
    // (ADR-0023) — and the user may well want to retype over it instead.
    editor.view.focus();
  }, [editor]);

  const handleSend = useCallback(
    async (intent: "change" | "discuss") => {
      const { from, to } = editor.state.selection;
      // Snapshot HERE, not when the selection was made: ProseMirror has been
      // mapping these positions through every concurrent edit, so the excerpt
      // describes what the block says at the moment the user actually asks.
      const anchor = anchorFor(aim.path, docBlocks(editor.state.doc), from, to);
      if (!anchor || !text.trim()) return;
      setSending(true);
      const sent = await aim.send(text.trim(), anchor, intent);
      setSending(false);
      // A refused send keeps the words: they are the only copy, and the user
      // has to be able to try again without retyping.
      if (sent) close();
    },
    [editor, aim, text, close],
  );

  const busy = aim.busyReason !== "";
  const disabled = busy || sending || text.trim() === "";

  return (
    <Box ref={hostRef} sx={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {placement && (hasRange || open) && (
        <Box
          sx={{ position: "absolute", top: placement.top, left: placement.left, pointerEvents: "auto", zIndex: 5 }}
          // The whole surface sits inside a contenteditable's box: a mousedown
          // reaching the editor would move the caret before the click landed.
          onMouseDown={(e) => e.preventDefault()}
        >
          {open ? (
            <Paper elevation={4} data-testid="aim-box" sx={{ width: 320, p: 1 }}>
              <TextField
                inputRef={inputRef}
                fullWidth
                multiline
                maxRows={4}
                size="small"
                placeholder="What should change here?"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    close();
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend("change");
                  }
                }}
              />
              <Stack direction="row" spacing={1} sx={{ mt: 1 }} justifyContent="flex-end">
                <Tooltip title={busy ? aim.busyReason : "Talk it through before anything changes"}>
                  <span>
                    <Button size="small" disabled={disabled} onClick={() => void handleSend("discuss")}>
                      Discuss
                    </Button>
                  </span>
                </Tooltip>
                <Tooltip title={busy ? aim.busyReason : "Rewrite the selection"}>
                  <span>
                    <Button
                      size="small"
                      variant="contained"
                      disabled={disabled}
                      onClick={() => void handleSend("change")}
                    >
                      Change
                    </Button>
                  </span>
                </Tooltip>
              </Stack>
            </Paper>
          ) : (
            <Chip
              data-testid="aim-chip"
              icon={<Crosshair size={14} />}
              label="Ask agent  ⌘K"
              size="small"
              onClick={() => setOpen(true)}
              sx={{ boxShadow: 2, bgcolor: "background.paper", cursor: "pointer" }}
            />
          )}
        </Box>
      )}
    </Box>
  );
}
