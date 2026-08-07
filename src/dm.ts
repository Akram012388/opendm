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
        const isDm = last?.role === "user" && last.metadata?.dm_reply === true
        if (isDm) {
          const from = typeof last.metadata?.from === "string" ? last.metadata.from : null
          const fromName = typeof last.metadata?.fromName === "string" ? last.metadata.fromName : "the sender"
          event.system.push({
            type: "text",
            text: `You just received a DM from "${fromName}"${from ? ` (session ${from})` : ""}. You MUST reply to the sender as a DM: call the dm tool with to: "${from}", content: <your reply>, delivery: "steer", dm_reply: false. Do NOT merely answer in this session — the reply must go back to the sender via the dm tool. Reply once and then stop.`,
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
            "DM another session by registered name or raw session ID. delivery: steer = interrupt the receiver now, queue = deliver on its next turn. dm_reply: true = the receiver must autonomously reply to you as a DM, false = no reply expected.",
          input: Schema.Struct({
            to: Schema.String,
            content: Schema.String,
            delivery: Schema.Literals(["steer", "queue"]),
            dm_reply: Schema.Boolean,
          }),
          output: Schema.String,
          options: { codemode: false },
          execute: ({ to, content, delivery, dm_reply }, { sessionID }) =>
            readRoster.pipe(
              Effect.flatMap((roster) => {
                const target = roster[to]?.id ?? (to as Session.ID)
                const senderName = Object.entries(roster).find(([, e]) => e.id === sessionID)?.[0]
                const sender = senderName ? `${senderName}-${sessionID.slice(0, 12)}…` : sessionID
                return ctx.session
                  .prompt({
                    sessionID: target,
                    text: `${DM_PREFIX}${sender}] ${content}`,
                    metadata: { from: sessionID, fromName: senderName ?? sessionID, dm_reply },
                    delivery,
                  })
                  .pipe(
                    Effect.map(() => ({
                      output: "delivered",
                      content: `delivered to ${to} (${delivery}, dm_reply: ${dm_reply})`,
                    })),
                  )
              }),
              Effect.mapError(() => toolError(`delivery failed to ${to}`)),
            ),
        })
      })
    }),
})
