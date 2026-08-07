import { Plugin } from "@opencode-ai/plugin/effect"
import { Session } from "@opencode-ai/schema/session"
import { Tool } from "@opencode-ai/schema/tool"
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

export default Plugin.define({
  id: "dm",
  effect: (ctx) =>
    Effect.gen(function* () {
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
            "DM another session by registered name or raw session ID. steer = interrupt the receiver now; queue = deliver on its next turn.",
          input: Schema.Struct({
            to: Schema.String,
            content: Schema.String,
            delivery: Schema.Literals(["steer", "queue"]),
          }),
          output: Schema.String,
          options: { codemode: false },
          execute: ({ to, content, delivery }, { sessionID }) =>
            readRoster.pipe(
              Effect.flatMap((roster) => {
                const target = roster[to]?.id ?? (to as Session.ID)
                const senderName = Object.entries(roster).find(([, e]) => e.id === sessionID)?.[0]
                const sender = senderName ? `${senderName}-${sessionID.slice(0, 12)}…` : sessionID
                return ctx.session
                  .prompt({
                    sessionID: target,
                    text: `[DM from ${sender}] ${content}`,
                    metadata: { from: sessionID, fromName: senderName ?? sessionID },
                    delivery,
                  })
                  .pipe(
                    Effect.map(() => ({ output: "delivered", content: `delivered to ${to} (${delivery})` })),
                  )
              }),
              Effect.mapError(() => toolError(`delivery failed to ${to}`)),
            ),
        })
      })
    }),
})
