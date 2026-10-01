# The chat's width

Beside the page, the chat and the page split the room right of the rail in the
golden ratio, the chat taking the smaller part (1 / (1 + φ) ≈ 38.2%). The rule
is `chatWidth` (`features/shell/chatWidth.ts`); the shell reads it through
`useChatWidth`.

- **Default:** the golden share, tracked live as the window changes. Nothing is
  stored until the user drags.
- **Drag:** the chat's right border is the handle (`ChatResizeHandle`), mouse
  only. A drag pins a px width, kept in this browser for every project
  (`aep:shell:chat-width`); a pinned width no longer follows the window.
- **Bounds:** never under 320px, never over half the room, so the chat stays
  the shorter section. The cap applies as the shell draws, so a width pinned on
  a wide screen is held back on a narrow one without being overwritten.
- **Reset:** double-clicking the handle forgets the pinned width: back to the
  live golden share.
- **Phone width:** the chat is an overlay at a fixed `CHAT_OVERLAY_WIDTH`, with
  no handle; nothing sits beside it to split with.
