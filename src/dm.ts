import { Plugin } from "@opencode-ai/plugin/effect"
import { Session } from "@opencode-ai/schema/session"
import { Tool } from "@opencode-ai/schema/tool"
import type { SystemPart } from "@opencode-ai/ai"
import { Effect, Schema } from "effect"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"

const ROSTER_PATH = path.join(os.homedir(), ".opendm", "roster.json")

type Entry = { id: Session.ID; updatedAt: number }
type Roster = Record<string, Entry>

const readRoster = Effect.tryPromise(async (): Promise<Roster> => {
  try {
    return JSON.parse(await fs.readFile(ROSTER_PATH, "utf8")) as Roster
  } catch {
    return {}
  }
})

const writeRoster = (roster: Roster) =>
  Effect.tryPromise(async () => {
    await fs.mkdir(path.dirname(ROSTER_PATH), { recursive: true })
    const tmp = `${ROSTER_PATH}.tmp`
    await fs.writeFile(tmp, JSON.stringify(roster, null, 2))
    await fs.rename(tmp, ROSTER_PATH)
  })

const toolError = (message: string) => new Tool.Error({ message })

const DM_PREFIX = "[DM from "

export default Plugin.define({
  id: "dm",
  effect: (ctx) =>
    Effect.gen(function* () {
      yield* ctx.session.hook("context", (event) => {
        const last = event.messages.at(-1)
        const meta = last?.role === "user" ? last.metadata : undefined
        const isDm = meta?.dm === true && typeof meta.from === "string"
        if (isDm) {
          const from = String(meta.from)
          const fromName = typeof meta.fromName === "string" ? meta.fromName : from
          const type = typeof meta.message_type === "string" ? meta.message_type : "task"
          const thread = typeof meta.thread_id === "string" ? meta.thread_id : null
          event.system.push({
            type: "text",
            text: `You just received a DM from "${fromName}" (session ${from}, type: ${type}${thread ? `, thread: ${thread}` : ""}). Acknowledge it briefly, act on it if it is addressed to you, and reply using the dm tool if a reply is expected — questions and tasks expect a reply, status messages do not. When replying, reuse thread_id "${thread}" if present and set delivery "steer". You do not need to wait for replies to your own DMs — continue your work.`,
          } satisfies SystemPart)
        }
        return Effect.succeed(void 0)
      })

      yield* ctx.tool.transform((tools) => {
        tools.add({
          name: "register",
          description: "Register this session under a friendly name, linked to its session ID",
          input: Schema.Struct({ name: Schema.String }),
          output: Schema.String,
          options: { codemode: false },
          execute: ({ name }, { sessionID }) =>
            readRoster.pipe(
              Effect.map((roster) => {
                roster[name] = { id: sessionID, updatedAt: Date.now() }
                return roster
              }),
              Effect.flatMap(writeRoster),
              Effect.map(() => ({ output: `registered "${name}"`, content: `registered "${name}" (${sessionID})` })),
              Effect.mapError(() => toolError("register failed")),
            ),
        })

        tools.add({
          name: "who",
          description: "List registered sessions (name → session ID)",
          input: Schema.Struct({}),
          output: Schema.String,
          options: { codemode: false },
          execute: () =>
            readRoster.pipe(
              Effect.map((roster) => {
                const lines = Object.entries(roster)
                  .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
                  .map(([name, entry]) => `${name} → ${entry.id} (${new Date(entry.updatedAt).toISOString()})`)
                const text = lines.length > 0 ? lines.join("\n") : "no sessions registered"
                return { output: text, content: text }
              }),
              Effect.mapError(() => toolError("who failed")),
            ),
        })

        tools.add({
          name: "dm",
          description:
            "DM another session by registered name or raw session ID. delivery: steer = interrupt the receiver now, queue = deliver on its next turn. message_type: task, question, status, or review — the receiver decides whether to reply. thread_id groups a conversation (max 64 chars). priority: urgent, normal, or low.",
          input: Schema.Struct({
            to: Schema.String,
            content: Schema.String,
            delivery: Schema.Literals(["steer", "queue"]),
            message_type: Schema.optional(Schema.Literals(["task", "question", "status", "review"])),
            thread_id: Schema.optional(Schema.String),
            priority: Schema.optional(Schema.Literals(["urgent", "normal", "low"])),
          }),
          output: Schema.String,
          options: { codemode: false },
          execute: ({ to, content, delivery, message_type, thread_id, priority }, { sessionID }) =>
            readRoster.pipe(
              Effect.flatMap((roster) => {
                const target = roster[to]?.id ?? (to as Session.ID)
                const senderName = Object.entries(roster).find(([, e]) => e.id === sessionID)?.[0]
                const sender = senderName ? `${senderName}-${sessionID.slice(0, 12)}…` : sessionID
                return ctx.session
                  .prompt({
                    sessionID: target,
                    text: `${DM_PREFIX}${sender}] ${content}`,
                    metadata: {
                      from: sessionID,
                      fromName: senderName ?? sessionID,
                      dm: true,
                      ...(message_type ? { message_type } : {}),
                      ...(thread_id ? { thread_id } : {}),
                      ...(priority ? { priority } : {}),
                    },
                    delivery,
                  })
                  .pipe(
                    Effect.map(() => ({
                      output: "delivered",
                      content: `delivered to ${to} (${delivery})`,
                    })),
                  )
              }),
              Effect.mapError(() => toolError(`delivery failed to ${to}`)),
            ),
        })
      })
    }),
})
