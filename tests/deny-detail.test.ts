import assert from "node:assert/strict"
import { test } from "node:test"
import { Error as ToolError } from "@opencode/plugin/promise/tool"
import plugin from "../src/index"
import {
  blockedInfoFromError,
  buildDenyExplanation,
  DENY_DETAIL_MARKER,
  deniedResources,
  wildcardMatch,
} from "../src/deny-detail"

const rules = [
  { action: "shell", resource: "*", effect: "allow" },
  { action: "shell", resource: "rm *", effect: "deny" },
  { action: "read", resource: "*.env", effect: "deny" },
]

test("wildcard matching follows the OpenCode permission pattern rules", () => {
  assert.equal(wildcardMatch("git status", "git status *"), true)
  assert.equal(wildcardMatch("git status --short", "git status *"), true)
  assert.equal(wildcardMatch("rm -rf /tmp/x", "rm *"), true)
  assert.equal(wildcardMatch("echo 'rm -rf /tmp/x'", "rm *"), false)
  assert.equal(wildcardMatch("src/a.ts", "src/?.ts"), true)
  assert.equal(wildcardMatch(".env", "*.env"), true)
  assert.equal(wildcardMatch("secrets/.env.local", "*.env"), false)
  assert.equal(wildcardMatch("a b", "a * b *"), false)
  assert.equal(wildcardMatch("anything at all", "*"), true)
  assert.equal(wildcardMatch("a/b", "a\\b"), true)
})

test("denied resources select only the resources whose last matching rule denies", () => {
  const denied = deniedResources("shell", ["cat package.json", "rm -rf /tmp/x", "git status"], rules)
  assert.deepEqual(denied, [
    { resource: "rm -rf /tmp/x", rule: { action: "shell", resource: "rm *", effect: "deny" } },
  ])
})

test("the explanation names the denied resource, its rule, and the other parts of the call", () => {
  const detail = buildDenyExplanation({
    permission: "shell",
    resources: ["cat package.json", "rm -rf /tmp/x", "git status"],
    rules,
    reason: "blocked by a rule",
  })
  assert.ok(detail)
  assert.match(detail, /^Denied resource: "rm -rf \/tmp\/x"/)
  assert.match(detail, /rule: "shell" "rm \*" -> deny/)
  assert.match(detail, /Not denied in the same call: "cat package.json", "git status"/)
  assert.match(detail, /Reason: "blocked by a rule"/)
  assert.match(detail, /The whole call did not run/)
})

test("the explanation does not claim that every resource was denied when no rule matches", () => {
  const detail = buildDenyExplanation({
    permission: "shell",
    resources: ["cat a", "rm -rf /tmp/x"],
    rules: [{ action: "shell", resource: "*", effect: "allow" }],
  })
  assert.ok(detail)
  assert.match(detail, /Could not identify the deny rule\. Resources in the denied call: "cat a", "rm -rf \/tmp\/x"/)
  assert.doesNotMatch(detail, /Denied resource:/)
})

test("blocked information is read through a tool error wrapper", () => {
  const blocked = {
    _tag: "Permission.BlockedError",
    permission: "shell",
    resources: ["rm -rf /tmp/x"],
    rules,
  }
  const info = blockedInfoFromError({ message: "Unable to execute command", error: blocked })
  assert.deepEqual(info, { permission: "shell", resources: ["rm -rf /tmp/x"], rules })
  assert.equal(blockedInfoFromError({ message: "Permission denied" }), undefined)
})

test("an error that only has action-like fields is not treated as a permission denial", () => {
  const info = blockedInfoFromError({
    message: "Tool failed",
    error: { action: "deploy", resources: ["prod"] },
  })
  assert.equal(info, undefined)
})

test("a real tool error instance accepts the appended message and reason", async () => {
  const blocked = {
    _tag: "Permission.BlockedError",
    permission: "shell",
    resources: ["cat a", "rm -rf /tmp/x"],
    rules,
  }
  const failure = new ToolError({ message: "Unable to execute command", error: blocked })
  const gate = await setup()
  const event = await gate.run({ status: "error", tool: "shell", error: failure })
  assert.match(event.error.message, new RegExp(DENY_DETAIL_MARKER))
  assert.match(event.error.error.reason, /Denied resource: "rm -rf \/tmp\/x"/)
  assert.doesNotMatch(event.error.message, /^Permission denied/)
})

async function setup(
  options: Record<string, unknown> = {},
  permissions: { agent?: unknown[]; session?: unknown[] } = {},
) {
  let toolHook: ((event: any) => Promise<void>) | undefined
  let toolHooks = 0
  const setupOptions = { mode: "off", explain_denials: true, ...options }
  const ctx = {
    options: setupOptions,
    location: { directory: `/test/deny-detail/${Math.random()}` },
    storage: { get: async () => undefined },
    session: { get: async () => ({ data: { permissions: permissions.session ?? [] } }) },
    agent: { get: async () => ({ data: { permissions: permissions.agent ?? [] } }) },
    permission: { hook: async () => {} },
    rpc: { register: async () => {} },
    tool: { hook: async (name: string, callback: typeof toolHook) => {
      assert.equal(name, "execute.after")
      toolHook = callback
      toolHooks += 1
    } },
  }
  await plugin.setup(ctx as unknown as Parameters<typeof plugin.setup>[0])
  return {
    toolHooks: () => toolHooks,
    run: async (event: any) => {
      assert.ok(toolHook)
      await toolHook(event)
      return event
    },
  }
}

function deniedError(message = "Unable to execute command: cat package.json | grep foo && rm -rf /tmp/x") {
  return {
    message,
    error: {
      _tag: "Permission.BlockedError",
      permission: "shell",
      resources: ["cat package.json", "grep foo", "rm -rf /tmp/x"],
      rules,
    },
  }
}

test("a denied tool error gets the denied command and rule appended", async () => {
  const gate = await setup()
  const event = await gate.run({ status: "error", tool: "shell", error: deniedError() })
  assert.match(event.error.message, /^Unable to execute command: cat package\.json \| grep foo && rm -rf \/tmp\/x\n/)
  assert.match(event.error.message, /Denied resource: "rm -rf \/tmp\/x"/)
  assert.match(event.error.message, /Not denied in the same call: "cat package\.json", "grep foo"/)
  // OpenCode turns a wrapped BlockedError into the model-facing message, so its reason must change too.
  assert.match(event.error.error.reason, /^Permission denied: shell\nDenied resource: "rm -rf \/tmp\/x"/)
})

test("the hook does nothing for completed calls, feedback rejections, or a disabled option", async () => {
  const gate = await setup()
  const completed = await gate.run({ status: "completed", tool: "shell", result: { content: "ok" } })
  assert.equal(completed.result.content, "ok")

  const feedback = { message: "Use staging instead", error: { _tag: "Permission.CorrectedError", feedback: "Use staging" } }
  const corrected = await gate.run({ status: "error", tool: "shell", error: feedback })
  assert.equal(corrected.error.message, "Use staging instead")

  const disabled = await setup({ explain_denials: false })
  const disabledEvent = { status: "error", tool: "shell", error: deniedError() }
  assert.equal(disabled.toolHooks(), 0)
  assert.equal(disabledEvent.error.message, deniedError().message)
})

test("the hook uses the agent and session rules when the error has no rule list", async () => {
  const gate = await setup({ mode: "off", explain_denials: true }, {
    agent: [{ action: "shell", resource: "*", effect: "allow" }],
    session: [{ action: "shell", resource: "rm *", effect: "deny" }],
  })
  const error = {
    message: "Unable to execute command",
    error: {
      _tag: "Permission.BlockedError",
      permission: "shell",
      resources: ["cat a", "rm -rf /tmp/x"],
    },
  }
  const event = await gate.run({
    status: "error",
    tool: "shell",
    agent: "build",
    sessionID: "ses_test",
    error,
  })
  assert.match(event.error.message, /Denied resource: "rm -rf \/tmp\/x" \(rule: "shell" "rm \*" -> deny\)/)
  assert.match(event.error.message, /Not denied in the same call: "cat a"/)
})

test("the hook also uses the fallback rules when the error rule list has no deny", async () => {
  const gate = await setup({ mode: "off", explain_denials: true }, {
    session: [{ action: "shell", resource: "rm *", effect: "deny" }],
  })
  const error = {
    message: "Unable to execute command",
    error: {
      _tag: "Permission.BlockedError",
      permission: "shell",
      resources: ["cat a", "rm -rf /tmp/x"],
      rules: [{ action: "shell", resource: "*", effect: "allow" }],
    },
  }
  const event = await gate.run({ status: "error", tool: "shell", sessionID: "ses_test", error })
  assert.match(event.error.message, /Denied resource: "rm -rf \/tmp\/x"/)
})

test("a second run does not add the detail twice", async () => {
  const gate = await setup()
  const failure = deniedError()
  const event = { status: "error", tool: "shell", error: failure }
  await gate.run(event)
  const first = failure.message
  await gate.run(event)
  assert.equal(failure.message, first)
})

test("an existing denial reason is kept before the detail", async () => {
  const gate = await setup()
  const failure = deniedError()
  ;(failure.error as Record<string, unknown>).reason = "permission-gate: policy blocked"
  const event = await gate.run({ status: "error", tool: "shell", error: failure })
  assert.match(event.error.error.reason, /^permission-gate: policy blocked\nDenied resource:/)
  assert.doesNotMatch(event.error.error.reason, /\nReason:/)
})

test("a malformed permission error shape does not crash the hook", async () => {
  const gate = await setup()
  const event = await gate.run({
    status: "error",
    tool: "shell",
    error: { message: "failed", error: { _tag: "Permission.BlockedError", resources: "not-an-array" } },
  })
  assert.equal(event.error.message, "failed")
})
