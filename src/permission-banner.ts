import type { Data } from "@opencode/plugin/tui/context"

type Request = NonNullable<ReturnType<Data["session"]["permission"]["list"]>>[number]

export function permissionSessionIDs(sessionID: string, family: string[]): string[] {
  return [...new Set([sessionID, ...family])]
}

export function bannerRequest(
  sessionIDs: string[],
  list: Data["session"]["permission"]["list"],
): Request | undefined {
  for (const sessionID of sessionIDs) {
    const request = list(sessionID)?.[0]
    if (request) {
      return request.message?.startsWith("permission-gate:") ? request : undefined
    }
  }
  return undefined
}

export function bannerLabel(data: Data, request: Request): string {
  const session = data.session.get(request.sessionID)
  if (session && !session.parentID) {
    return "メイン"
  }
  const message = request.source?.type === "tool"
    ? data.session.message.get(request.sessionID, request.source.messageID)
    : undefined
  const agentID = message?.type === "assistant" ? message.agent : session?.agent
  const agents = data.location.agent.list(session?.location)
  const agentName = agents?.find((agent) => agent.id === agentID)?.name || agentID || "Agent"
  return `${agentName} | ${session?.title || request.sessionID}`
}
