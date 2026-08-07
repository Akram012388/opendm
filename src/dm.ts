import { Plugin } from "@opencode-ai/plugin/effect"
import { Session } from "@opencode-ai/schema/session"
import { Tool } from "@opencode-ai/schema/tool"
import { Effect, Schema } from "effect"

export default Plugin.define({
  id: "dm",
  effect: (ctx) =>
    Effect.gen(function* () {
      yield* ctx.tool.transform((tools) => {
        tools.add({
          name: "dm",
          description:
            "DM another session by ID. steer = interrupt the receiver now; queue = deliver on its next turn.",
          input: Schema.Struct({
            to: Session.ID,
            content: Schema.String,
            delivery: Schema.Literals(["steer", "queue"]),
          }),
          output: Schema.String,
          options: { codemode: false },
          execute: ({ to, content, delivery }, { sessionID }) =>
            ctx.session
              .synthetic({
                sessionID: to,
                text: `[DM from ${sessionID}] ${content}`,
                metadata: { from: sessionID },
                delivery,
              })
              .pipe(
                Effect.mapError(() => new Tool.Error({ message: `delivery failed to ${to}` })),
                Effect.map(() => ({ output: "delivered", content: `delivered to ${to} (${delivery})` })),
              ),
        })
      })
    }),
})
