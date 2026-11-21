import { Rpc } from "@opencode/plugin/rpc"

export const PermissionGate = Rpc.define({
  id: "permission-gate",
  methods: {
    run: {
      input: {
        type: "object",
        properties: {
          text: { type: "string" },
          sessionID: { type: "string" },
        },
        required: ["text"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          message: { type: "string" },
          ok: { type: "boolean" },
        },
        required: ["message", "ok"],
        additionalProperties: false,
      },
    },
  },
})
