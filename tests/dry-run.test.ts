import assert from "node:assert/strict"
import { test } from "node:test"
import type { PermissionEvaluation } from "@opencode/plugin/promise/permission"
import plugin from "../src/index"
import { bannerRequest, splitMessage } from "../src/permission-banner"

type Event = Pick<PermissionEvaluation, "action" | "effect" | "resources" | "message"> & { sessionID: string }
let sequence = 0

async function setup(options: Record<string, unknown> = {}, decision: unknown = { effect: "allow", reason: "Read only" }) {
  let hook!: (event: Event) => Promise<void>
  let calls = 0
  const directory = `/test/dry-run/${sequence++}`
  const ctx = {
    options: { mode: "dry-run", model: "test/model", variant: "none", audit_path: "/dev/null", ...options },
    location: { directory },
    storage: { get: async () => undefined },
    session: { get: async () => ({}) },
    permission: { hook: async (name: string, callback: typeof hook) => {
      assert.equal(name, "evaluate")
      hook = callback
    } },
    rpc: { register: async () => {} },
    experimental: { generate: { text: async () => {
      calls++
      return { text: JSON.stringify(decision) }
    } } },
  }
  await plugin.setup(ctx as unknown as Parameters<typeof plugin.setup>[0])
  return {
    calls: () => calls,
    evaluate: async (input: Partial<Event> = {}) => {
      const event: Event = { sessionID: directory, action: "shell", resources: ["git status"], effect: "ask", ...input }
      await hook(event)
      return event
    },
  }
}

test("dry-run evaluation shows proposals without applying any effect", async (t) => {
  for (const effect of ["allow", "ask", "deny"] as const) {
    await t.test(effect, async () => {
      const gate = await setup({}, { effect, reason: "Review: details", hint: "Inspect: files | then approve" })
      const event = await gate.evaluate()
      assert.equal(event.effect, "ask")
      assert.equal(gate.calls(), 1)
      assert.equal(event.message, `permission-gate: dry-run (proposed ${effect}; unchanged): Review: details | Inspect: files | then approve`)
      const pending = { ...event, id: "pending", resources: [...event.resources] }
      assert.equal(bannerRequest([event.sessionID], () => [pending]), pending)
      assert.deepEqual(splitMessage(event.message!), {
        reason: `dry-run (proposed ${effect}; unchanged): Review: details`,
        hint: "Inspect: files | then approve",
      })
    })
  }
})

test("dry-run proposals include review policies rather than raw model effects", async () => {
  for (const [decision, options, proposed] of [
    [{ effect: "deny", reason: "Risk" }, { on_danger: "ask" }, "ask"],
    [{ effect: "ask", reason: "Unclear" }, { on_ask: "deny" }, "deny"],
    [{}, { on_failure: "deny" }, "deny"],
    [{}, {}, "ask"],
  ] as const) {
    const gate = await setup(options, decision)
    const event = await gate.evaluate()
    assert.equal(event.effect, "ask")
    assert.match(event.message!, new RegExp(`dry-run \\(proposed ${proposed}; unchanged\\):`))
    if (!("effect" in decision)) {
      assert.match(event.message!, /review unavailable/)
    }
  }
})

test("dangerous-pattern dry-run shows a proposal without invoking the model", async () => {
  for (const effect of ["ask", "deny"] as const) {
    const gate = await setup({ on_danger: effect })
    const event = await gate.evaluate({ resources: ["sudo true"] })
    assert.equal(event.effect, "ask")
    assert.equal(event.message, `permission-gate: dry-run (proposed ${effect}; unchanged): dangerous pattern`)
    assert.equal(gate.calls(), 0)
    assert.deepEqual(splitMessage(event.message!), {
      reason: `dry-run (proposed ${effect}; unchanged): dangerous pattern`, hint: "",
    })
    const pending = { ...event, id: "danger", resources: [...event.resources] }
    assert.equal(bannerRequest([event.sessionID], () => [pending]), pending)
  }
})

test("off, skipped actions, and pre-existing allow or deny remain untouched", async () => {
  for (const [options, input] of [
    [{ mode: "off" }, {}],
    [{}, { action: "question" }],
    [{}, { action: "external_directory" }],
    [{}, { action: "subagent" }],
    [{}, { effect: "allow" }],
    [{}, { effect: "deny" }],
  ] as const) {
    const gate = await setup(options)
    const event = await gate.evaluate({ ...input, message: "Original message" })
    assert.equal(event.effect, "effect" in input ? input.effect : "ask")
    assert.equal(event.message, "Original message")
    assert.equal(gate.calls(), 0)
  }
})

test("auto keeps existing effects and messages", async () => {
  for (const [effect, expected] of [
    ["allow", "permission-gate: Review"],
    ["ask", "permission-gate: Review | Hint"],
    ["deny", "permission-gate: Review (blocked)"],
  ] as const) {
    const gate = await setup({ mode: "auto" }, { effect, reason: "Review", hint: "Hint" })
    const event = await gate.evaluate()
    assert.equal(event.effect, effect)
    assert.equal(event.message, expected)
  }
  for (const effect of ["ask", "deny"] as const) {
    const gate = await setup({ mode: "auto", on_danger: effect })
    const event = await gate.evaluate({ resources: ["sudo true"] })
    assert.equal(event.effect, effect)
    assert.equal(event.message, effect === "deny"
      ? "permission-gate: blocked by a dangerous pattern"
      : "permission-gate: dangerous pattern")
  }
})
