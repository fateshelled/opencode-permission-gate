import assert from "node:assert/strict"
import { test } from "node:test"
import plugin from "../src/index"

type Mode = "off" | "dry-run" | "auto"
type Event = { sessionID: string; agent?: string; action: string; effect: string; resources: string[] }
type Run = (input: { sessionID: string; text: string }) => Promise<{ ok: boolean; message: string }>

const stored = new Map<string, unknown>()
const parents = new Map<string, unknown>()
const lookups: string[] = []
let run: Run
let failStorage = false

async function setup(options: Record<string, unknown> = {}) {
  let hook!: (event: Event) => Promise<void>
  const ctx = {
    options: { model: "test/model", audit_path: "/dev/null", ...options },
    storage: {
      get: async (key: string) => {
        if (failStorage) {
          throw new Error("storage unavailable")
        }
        return stored.get(key)
      },
      set: async (key: string, value: unknown) => { stored.set(key, value) },
      remove: async (key: string) => { stored.delete(key) },
    },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => {
        lookups.push(sessionID)
        const value = parents.get(sessionID)
        if (value instanceof Error) {
          throw value
        }
        return value
      },
    },
    permission: { hook: async (_name: string, callback: typeof hook) => { hook = callback } },
    rpc: { register: async (_definition: unknown, methods: { run: Run }) => { run = methods.run } },
  }
  await plugin.setup(ctx as unknown as Parameters<typeof plugin.setup>[0])
  return async (sessionID: string, agent?: string) => {
    const event: Event = { sessionID, agent, action: "shell", effect: "ask", resources: ["sudo true"] }
    await hook(event)
    return event.effect
  }
}

const setMode = (sessionID: string, mode: Mode | "reset" | "toggle") => run({ sessionID, text: mode })
const modeStatus = async (sessionID: string) => (await run({ sessionID, text: "status" })).message

test("session mode inheritance and commands", async (t) => {
  const evaluate = await setup({ inherit_to_child_sessions: true, auto_agents: ["worker"] })

  await t.test("parent auto applies to children and deep descendants without copying modes", async () => {
    parents.set("child", { parentID: "parent" })
    parents.set("grandchild", { data: { parentID: "child" } })
    parents.set("parent", {})
    await setMode("parent", "auto")
    assert.equal(await evaluate("child"), "deny")
    assert.equal(await evaluate("grandchild"), "deny")
    assert.equal(stored.has("session-mode:child"), false)
    assert.equal(stored.has("session-mode:grandchild"), false)
  })

  await t.test("child off and dry-run override parent auto and auto_agents", async () => {
    await setMode("child", "off")
    lookups.length = 0
    assert.equal(await evaluate("child", "worker"), "ask")
    assert.deepEqual(lookups, [])
    await setMode("child", "dry-run")
    assert.equal(await evaluate("child"), "ask")
    assert.match(await modeStatus("child"), /session=dry-run/)
    assert.match(await modeStatus("grandchild"), /session=dry-run/)
  })

  await t.test("nearest explicit ancestor wins, including off over auto_agents", async () => {
    await setMode("child", "off")
    assert.equal(await evaluate("grandchild", "worker"), "ask")
    await setMode("child", "auto")
    await setMode("parent", "off")
    assert.equal(await evaluate("grandchild"), "deny")
  })

  await t.test("parent changes and resets apply dynamically but keep child overrides", async () => {
    await setMode("child", "reset")
    assert.equal(await evaluate("grandchild"), "ask")
    await setMode("parent", "auto")
    assert.equal(await evaluate("grandchild"), "deny")
    await setMode("grandchild", "off")
    await setMode("parent", "reset")
    assert.equal(await evaluate("child"), "ask")
    assert.equal(await evaluate("child", "worker"), "deny")
    assert.equal(await evaluate("grandchild", "worker"), "ask")
    await setMode("parent", "auto")
    assert.equal(await evaluate("child"), "deny")
    assert.equal(await evaluate("grandchild"), "ask")
    await setMode("grandchild", "reset")
    assert.equal(await evaluate("grandchild"), "deny")
  })

  await t.test("toggle starts from inherited mode and creates an own override", async () => {
    await setMode("child", "toggle")
    assert.match(await modeStatus("child"), /session=off/)
    await setMode("parent", "dry-run")
    assert.match(await modeStatus("child"), /session=off/)
    await setMode("child", "reset")
    assert.match(await modeStatus("child"), /session=dry-run/)
  })

  await t.test("ancestor modes can come from storage", async () => {
    parents.set("stored-child", { parentID: "stored-parent" })
    stored.set("session-mode:stored-parent", "auto")
    assert.equal(await evaluate("stored-child"), "deny")
    await setMode("stored-parent", "off")
    assert.equal(await evaluate("stored-child"), "ask")
    await setMode("stored-parent", "reset")
    assert.equal(await evaluate("stored-child"), "ask")
  })

  await t.test("an ancestor's auto_agents mode is not inherited", async () => {
    parents.set("agent-child", { parentID: "agent-parent" })
    parents.set("agent-parent", { agent: "worker" })
    assert.equal(await evaluate("agent-parent", "worker"), "deny")
    assert.equal(await evaluate("agent-child"), "ask")
  })

  await t.test("invalid stored modes do not block a more distant explicit ancestor", async () => {
    parents.set("invalid-mode-child", { parentID: "invalid-mode-parent" })
    parents.set("invalid-mode-parent", { parentID: "parent" })
    stored.set("session-mode:invalid-mode-parent", "manual")
    await setMode("parent", "auto")
    assert.equal(await evaluate("invalid-mode-child"), "deny")
  })

  await t.test("cycles terminate and use the normal fallback", async () => {
    parents.set("cycle-a", { parentID: "cycle-b" })
    parents.set("cycle-b", { parentID: "cycle-a" })
    lookups.length = 0
    assert.equal(await evaluate("cycle-a"), "ask")
    assert.deepEqual(lookups, ["cycle-a", "cycle-b"])
    assert.equal(await evaluate("cycle-a", "worker"), "deny")
    parents.set("self", { parentID: "self" })
    assert.equal(await evaluate("self"), "ask")
  })

  await t.test("missing, invalid, and unavailable metadata use the normal fallback", async () => {
    for (const [id, value] of [
      ["missing", undefined], ["invalid", { parentID: 42 }],
      ["unavailable", new Error("unavailable")], ["empty", { parentID: "" }],
    ] as const) {
      parents.set(id, value)
      assert.equal(await evaluate(id), "ask")
      assert.equal(await evaluate(id, "worker"), "deny")
    }
    parents.set("missing-ancestor", { parentID: "not-loaded" })
    assert.equal(await evaluate("missing-ancestor"), "ask")
  })

  await t.test("storage failure does not prevent the agent fallback", async () => {
    failStorage = true
    try {
      assert.equal(await evaluate("no-storage", "worker"), "deny")
    } finally {
      failStorage = false
    }
  })

  await t.test("omitted setting enables inheritance by default", async () => {
    await setMode("parent", "auto")
    const defaults = await setup()
    lookups.length = 0
    assert.equal(await defaults("child"), "deny")
    assert.deepEqual(lookups, ["child"])
  })

  await t.test("true and invalid settings use inheritance", async () => {
    for (const value of [true, undefined, "true", "false", 0, 1, null, [], {}]) {
      const enabled = await setup({ inherit_to_child_sessions: value })
      lookups.length = 0
      assert.equal(await enabled("child"), "deny")
      assert.deepEqual(lookups, ["child"])
    }
  })

  await t.test("explicit false disables inheritance without parent lookups", async () => {
    const disabled = await setup({ inherit_to_child_sessions: false, auto_agents: ["worker"] })
    lookups.length = 0
    assert.equal(await disabled("child"), "ask")
    assert.equal(await disabled("child", "worker"), "deny")
    assert.deepEqual(lookups, [])
  })

  await t.test("global auto and dry-run remain available without an ancestor mode", async () => {
    const auto = await setup({ inherit_to_child_sessions: true, mode: "auto" })
    assert.equal(await auto("global-auto"), "deny")
    const dryRun = await setup({ inherit_to_child_sessions: true, mode: "dry-run" })
    assert.equal(await dryRun("global-dry-run"), "ask")
  })
})
