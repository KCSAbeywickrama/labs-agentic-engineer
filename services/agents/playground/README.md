# Playground — terminal chat over the spec agent

A dev TUI for driving the main spec agent by hand. A **thread** is a folder under
`services/agents/chat_playground/<name>/`; chatting at it edits the files in place
(multi-turn). The agent service writes nothing — this client owns the disk.

## Run

```bash
pnpm --filter @aep/agents playground
```

Requires `ANTHROPIC_API_KEY` in `deployments/.env` (already set up by
`deployments/scripts/setup-asdlc.sh`).

## Steps
1. Create a folder called `services/agents/chat_playground`
2. **Add files** to that thread folder however you like, e.g. clone a spec repo:
   ```bash
   cd services/agents/chat_playground && git clone https://github.com/asdlc-repos/apii043
   ```
   (the folder name is the thread — here `apii043`; pick it from the menu next run.)
3. Run `pnpm --filter @aep/agents playground` you should see the project there.
4. **Start chatting**, e.g. `change this to an echo service`.
5. **Check the result** in `services/agents/chat_playground/<thread>/` — the agent's
   edits are written there.

In a thread: `/threads` switches, `/quit` (or Ctrl-D) exits. Hand-edit files anytime;
the next turn picks them up. `-- --dry-run` streams without writing.
