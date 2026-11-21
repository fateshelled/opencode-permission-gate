import assert from "node:assert/strict"
import { test } from "node:test"
import type { Data } from "@opencode/plugin/tui/context"
import { bannerLabel, bannerRequest, permissionSessionIDs, splitMessage } from "../src/permission-banner"

type Request = NonNullable<ReturnType<Data["session"]["permission"]["list"]>>[number]

function request(sessionID: string, id: string, message?: string): Request {
  return { sessionID, id, message, action: "shell", resources: [] }
}

const gate = (sessionID: string, id: string) => request(sessionID, id, "permission-gate: Review | Check")

test("message parsing keeps colons and splits only the first hint delimiter", () => {
  assert.deepEqual(splitMessage("permission-gate: Reason: details | Hint: details | more"), {
    reason: "Reason: details", hint: "Hint: details | more",
  })
  assert.deepEqual(splitMessage("permission-gate: Reason: details"), { reason: "Reason: details", hint: "" })
  assert.deepEqual(splitMessage(""), { reason: "", hint: "" })
})

test("current session comes first and duplicate family IDs are removed without sorting", () => {
  assert.deepEqual(permissionSessionIDs("main", ["child-b", "main", "child-a", "child-b"]), [
    "main", "child-b", "child-a",
  ])
})

test("current session request takes priority over descendant requests", () => {
  const own = gate("main", "own")
  const queues = { main: [own], child: [gate("child", "child-request")] }
  assert.equal(bannerRequest(["main", "child"], (id) => queues[id as keyof typeof queues]), own)
})

test("first descendant request follows family order, including nested descendants", () => {
  const first = gate("grandchild", "first")
  const queues: Record<string, Request[]> = {
    grandchild: [first], child: [gate("child", "second")],
  }
  assert.equal(bannerRequest(["main", "grandchild", "child"], (id) => queues[id]), first)
})

test("a native request blocks a later gate request in the same session", () => {
  assert.equal(bannerRequest(["main"], () => [request("main", "native"), gate("main", "later")]), undefined)
})

test("a native request blocks gate requests in later descendants", () => {
  const queues: Record<string, Request[]> = {
    child: [request("child", "native", "Another plugin")],
    grandchild: [gate("grandchild", "later")],
  }
  assert.equal(bannerRequest(["main", "child", "grandchild"], (id) => queues[id]), undefined)
})

test("queue changes reveal the child banner only after the parent's native request is removed", () => {
  const child = gate("child", "child-request")
  const queues: Record<string, Request[]> = { main: [request("main", "native")], child: [child] }
  const selected = () => bannerRequest(["main", "child"], (id) => queues[id])
  assert.equal(selected(), undefined)
  queues.main = []
  assert.equal(selected(), child)
  queues.child = []
  assert.equal(selected(), undefined)
})

test("empty and unsynced permission queues have no banner", () => {
  assert.equal(bannerRequest(["main", "child"], (id) => id === "main" ? [] : undefined), undefined)
})

function labelData(options: {
  session?: { parentID?: string; agent?: string; title?: string; location?: { directory: string } }
  message?: { type: string; agent?: string }
  agents?: { id: string; name: string }[]
} = {}): Data {
  return {
    session: { get: () => options.session, message: { get: () => options.message } },
    location: { agent: { list: () => options.agents } },
  } as unknown as Data
}

test("a loaded root session uses the approved main label", () => {
  assert.equal(bannerLabel(labelData({ session: { title: "Main" } }), gate("main", "own")), "メイン")
})

test("a child viewed directly uses its agent name and session title", () => {
  const child = gate("child", "own")
  const data = labelData({
    session: { parentID: "main", agent: "explore", title: "Investigate permissions" },
    agents: [{ id: "explore", name: "Explore" }],
  })
  const selected = bannerRequest(permissionSessionIDs("child", []), () => [child])
  assert.equal(selected, child)
  assert.equal(bannerLabel(data, selected!), "Explore | Investigate permissions")
})

test("an unloaded viewed session is not assumed to be main", () => {
  assert.equal(bannerLabel(labelData(), gate("child", "own")), "Agent | child")
})

test("child label uses source assistant agent display name and session title", () => {
  const child = gate("child", "child-request")
  child.source = { type: "tool", messageID: "source", id: "tool" }
  const data = labelData({
    session: { parentID: "main", agent: "session-agent", title: "Investigate permissions" },
    message: { type: "assistant", agent: "source-agent" },
    agents: [{ id: "source-agent", name: "Explore" }],
  })
  const selected = bannerRequest(permissionSessionIDs("main", ["child"]), (id) => id === "child" ? [child] : [])
  assert.equal(selected, child)
  assert.equal(bannerLabel(data, selected!), "Explore | Investigate permissions")
})

test("missing source message falls back to session agent and unknown agent ID", () => {
  const child = gate("child", "child-request")
  child.source = { type: "tool", messageID: "missing", id: "tool" }
  assert.equal(bannerLabel(labelData({ session: { parentID: "main", agent: "custom-agent" } }), child), "custom-agent | child")
})

test("non-assistant source falls back to the session agent display name", () => {
  const child = gate("child", "child-request")
  child.source = { type: "tool", messageID: "source", id: "tool" }
  const data = labelData({
    session: { parentID: "main", agent: "session-agent", title: "Child" },
    message: { type: "user" },
    agents: [{ id: "session-agent", name: "Build" }],
  })
  assert.equal(bannerLabel(data, child), "Build | Child")
})

test("missing child metadata has a readable fallback", () => {
  assert.equal(bannerLabel(labelData(), gate("child", "child-request")), "Agent | child")
})

test("agent display names are read from the child's location", () => {
  const location = { directory: "/child/worktree" }
  const data = labelData({ session: { parentID: "main", agent: "explore", location } })
  let queried: unknown
  data.location.agent.list = (value) => {
    queried = value
    return []
  }
  assert.equal(bannerLabel(data, gate("child", "child-request")), "explore | child")
  assert.equal(queried, location)
})
