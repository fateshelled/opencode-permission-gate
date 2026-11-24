// Adds the denied resource and rule to a tool error, so the model can see
// which part of a compound command OpenCode denied.
export type DenyRule = {
  action: string
  resource: string
  effect: string
}

export type BlockedInfo = {
  permission: string
  resources: string[]
  rules: DenyRule[]
  reason?: string
}

export type DeniedResource = {
  resource: string
  rule: DenyRule
}

const PATH_ACTIONS = ["external_directory", "read", "edit"]
const MAX_RESOURCES = 6
const MAX_RESOURCE_CHARS = 300
const MAX_REASON_CHARS = 200
export const DENY_DETAIL_MARKER = "The whole call did not run. Remove or change only the denied part before you retry."

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function ignoresCase(action: string): boolean {
  return process.platform === "darwin" && PATH_ACTIONS.includes(action)
}

// Same whole-value wildcard matching that OpenCode uses for permission rules.
export function wildcardMatch(input: string, pattern: string, ignoreCase = false): boolean {
  const normalized = input.replaceAll("\\", "/")
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")

  if (escaped.endsWith(" .*")) {
    escaped = escaped.slice(0, -3) + "( .*)?"
  }

  return new RegExp("^" + escaped + "$", process.platform === "win32" || ignoreCase ? "si" : "s").test(normalized)
}

function matchingRule(permission: string, resource: string, rules: readonly DenyRule[]): DenyRule | undefined {
  const ignoreCase = ignoresCase(permission)
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    const rule = rules[index]
    if (wildcardMatch(permission, rule.action) && wildcardMatch(resource, rule.resource, ignoreCase)) {
      return rule
    }
  }
  return undefined
}

export function deniedResources(
  permission: string,
  resources: readonly string[],
  rules: readonly DenyRule[],
): DeniedResource[] {
  const denied: DeniedResource[] = []
  for (const resource of resources) {
    const rule = matchingRule(permission, resource, rules)
    if (rule?.effect === "deny") {
      denied.push({ resource, rule })
    }
  }
  return denied
}

function parseRules(value: unknown): DenyRule[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item): DenyRule[] => {
    if (!isRecord(item)) {
      return []
    }
    if (typeof item.action !== "string" || typeof item.resource !== "string" || typeof item.effect !== "string") {
      return []
    }
    return [{ action: item.action, resource: item.resource, effect: item.effect }]
  })
}

function inspect(value: unknown): BlockedInfo | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const permission = typeof value.permission === "string"
    ? value.permission
    : typeof value.action === "string"
      ? value.action
      : undefined
  const resources = Array.isArray(value.resources)
    ? value.resources.filter((item): item is string => typeof item === "string")
    : undefined
  if (!permission || !resources || resources.length === 0) {
    return undefined
  }
  const rules = parseRules(value.rules)
  const tag = typeof value._tag === "string" ? value._tag : typeof value.name === "string" ? value.name : ""
  const identified = tag.includes("BlockedError") || tag.includes("PermissionDenied")
  if (!identified && rules.length === 0) {
    return undefined
  }
  const info: BlockedInfo = {
    permission,
    resources,
    rules,
  }
  if (typeof value.reason === "string" && value.reason.length > 0) {
    info.reason = value.reason
  }
  return info
}

// A tool error can wrap the permission error. Look through the chain.
function findBlocked(error: unknown): Record<string, unknown> | undefined {
  let current = error
  for (let depth = 0; depth < 4 && current !== undefined; depth += 1) {
    if (isRecord(current) && inspect(current)) {
      return current
    }
    current = isRecord(current) ? current.error : undefined
  }
  return undefined
}

export function blockedDetailsFromError(
  error: unknown,
): { info: BlockedInfo; source: Record<string, unknown> } | undefined {
  const source = findBlocked(error)
  if (!source) {
    return undefined
  }
  const info = inspect(source)
  return info ? { info, source } : undefined
}

export function blockedInfoFromError(error: unknown): BlockedInfo | undefined {
  return blockedDetailsFromError(error)?.info
}

function quote(value: string): string {
  const text = value.length > MAX_RESOURCE_CHARS ? `${value.slice(0, MAX_RESOURCE_CHARS)}...` : value
  return JSON.stringify(text)
}

function formatRule(rule: DenyRule): string {
  return `${quote(rule.action)} ${quote(rule.resource)} -> deny`
}

export function buildDenyExplanation(info: BlockedInfo, fallbackRules: readonly DenyRule[] = []): string | undefined {
  const rules = [...info.rules, ...fallbackRules]
  const denied = deniedResources(info.permission, info.resources, rules)
  const lines: string[] = []

  if (denied.length > 0) {
    const shown = denied.slice(0, MAX_RESOURCES)
    lines.push(
      `${denied.length === 1 ? "Denied resource" : "Denied resources"}: ` +
        shown.map((item) => `${quote(item.resource)} (rule: ${formatRule(item.rule)})`).join("; "),
    )
    if (denied.length > shown.length) {
      lines.push(`... and ${denied.length - shown.length} more denied resources.`)
    }
    const deniedNames = new Set(denied.map((item) => item.resource))
    const allowed = info.resources.filter((resource) => !deniedNames.has(resource))
    if (allowed.length > 0) {
      lines.push(
        `Not denied in the same call: ${allowed.slice(0, MAX_RESOURCES).map(quote).join(", ")}` +
          (allowed.length > MAX_RESOURCES ? `, ... and ${allowed.length - MAX_RESOURCES} more` : ""),
      )
    }
  } else {
    const label = rules.length > 0
      ? "Could not identify the deny rule. Resources in the denied call"
      : "Resources in the denied call"
    lines.push(
      `${label}: ` +
        info.resources.slice(0, MAX_RESOURCES).map(quote).join(", ") +
        (info.resources.length > MAX_RESOURCES ? `, ... and ${info.resources.length - MAX_RESOURCES} more` : ""),
    )
  }

  if (info.reason) {
    const reason = info.reason.length > MAX_REASON_CHARS
      ? `${info.reason.slice(0, MAX_REASON_CHARS)}...`
      : info.reason
    lines.push(`Reason: ${JSON.stringify(reason)}`)
  }

  lines.push(DENY_DETAIL_MARKER)
  return lines.join("\n")
}
