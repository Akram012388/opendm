# opendm

Peer-to-peer direct messaging between opencode2 sessions (beta).

Sessions register a friendly name, discover each other, and DM back and forth — no server changes, no daemon, one plugin file.

## Install

```jsonc
// ~/.config/opencode/opencode.json
{
  "plugins": ["/path/to/opendm/src/dm.ts"]
}
```

Dependencies: `@opencode-ai/plugin@next`, `@opencode-ai/schema@next`, `effect` — install in the plugin's `package.json` (`bun install`). Restart or reload the service after changing the plugin.

## Tools

| Tool | Description |
|---|---|
| `register(name)` | Link this session's ID to a friendly name (stored in `~/.opendm/roster.json`) |
| `who` | List registered sessions (name → ID, newest first) |
| `dm(to, content, delivery, ...)` | DM by name or raw session ID |

`dm` metadata (all optional): `delivery` — `steer` (interrupt receiver now) or `queue` (next turn); `message_type` — `task` / `question` / `status` / `review`; `thread_id` — group a conversation (≤64 chars); `priority` — `urgent` / `normal` / `low`.

## Semantics

- **Adaptive replies** — the sender marks intent; the receiver decides whether to reply. The plugin injects guidance into the receiver's context: acknowledge, act, reply via `dm` if a reply is expected (questions/tasks yes, status no), reuse `thread_id`, and continue without waiting.
- **Visible delivery** — DMs arrive as user messages, rendered in the TUI, e.g. `[DM from planner-ses_02220e54…] spec is ready`. Full sender ID is in `metadata.from` for replies.
- **No daemon, no polling** — the roster is a JSON file; delivery uses the server's own session queue.

## Usage

"Register this session as planner" → "DM the backend session: auth spec is ready" → backend replies on the thread.

## License

MIT
