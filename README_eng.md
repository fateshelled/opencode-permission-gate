# opencode-permission-gate

English | [日本語](README.md)

This plugin uses an LLM to help with permission decisions in OpenCode V2. \
It reviews actions for which OpenCode requests user confirmation (`ask`). \
The review result is automatic approval (`allow`), continued user confirmation (`ask`), or rejection (`deny`).

**The default mode is `off` (disabled).** Installation alone does not enable reviews. \
First, use `dry-run` to see the proposed effects without a change to permission decisions. \
After you examine the results, switch to `auto` to apply review results automatically.

## Features

- **Reviews only `ask` decisions**: The plugin does not change explicit `deny` rules.
- **Uses the session model automatically**: By default, reviews use the same model as the current session.
- **Three modes**: You can select `off` (disabled), `dry-run` (review without a change to decisions), or `auto` (automatic decisions).
- **Configurable options**: The configuration file sets the default mode, policies for dangerous actions, language for review reasons, and other options.
- **Safety controls**: You can block actions that the review identifies as dangerous or request user confirmation.
- **Deny details**: If a configured OpenCode rule denies an action, the plugin adds the denied part of the command and the rule that matched to the tool error.
- **Audit log**: The plugin records review decisions as one JSON object per line.
- **TUI commands**: You can change modes and see the status in the terminal.

## Requirements

- OpenCode V2 with support for the V2 plugin API
- A chat model that supports short JSON output

## Installation

### From GitHub

Add the plugin with this command.

```sh
opencode plugin add github:fateshelled/opencode-permission-gate
```

The command adds the plugin name as a string in the configuration file (`opencode.jsonc`).

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["github:fateshelled/opencode-permission-gate"]
}
```

To set options, change the entry to this object format. \
This example selects `auto`. For an initial trial, select `dry-run`.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "github:fateshelled/opencode-permission-gate",
      "options": {
        "mode": "auto",
        "language": "Japanese",
      },
    },
  ],
}
```

### From a local clone

Clone the repository locally. \
Set the clone directory in the configuration file (`~/.config/opencode/opencode.jsonc`).

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "/path/to/opencode-permission-gate",
      "options": {
        "mode": "off",
        "model": "session",
        "on_danger": "deny",
      },
    },
  ],
}
```

The path can be relative to the configuration file.

## Quick start

After installation, do these steps in the TUI. \
By default, a mode set by a command also applies to descendant sessions without their own explicit mode.

1. **Set `dry-run` mode** \
   Enable reviews in the current session without a change to permission decisions.

   ```text
   /permission-gate-dry-run
   ```

2. **Run a command that needs permission confirmation** \
   Work as usual. Examine the user confirmation and the proposed effect in the banner. The original `ask` does not change.

3. **Examine the audit log** \
   Open this default log file to examine the decisions. \
   Refer to `audit_path` for the conditions that determine the output path.

   ```text
   ~/.local/share/opencode/permission-gate.jsonl
   ```

4. **Switch to `auto` mode** \
   If the decisions in the log have no problems, apply review results to actions.

   ```text
   /permission-gate-auto
   ```

To stop reviews, run `/permission-gate-off`. \
Before you use `auto`, also read "Security notes."

## Modes

| Mode      | Behavior                                                                                                 |
| :-------- | :------------------------------------------------------------------------------------------------------- |
| `off`     | Stop reviews and permission changes (default). `explain_denials` continues to operate.                   |
| `dry-run` | Show the proposed effect in the banner and record it in the audit log. Keep the original `ask` decision. |
| `auto`    | Change the decision to `allow` / `deny` / `ask` from the review result.                                  |

- Set the global mode with `mode` in the configuration file.
- By default, mode changes from TUI commands also apply to descendant sessions without their own explicit mode.
- To limit changes from TUI commands to the current session, set `inherit_to_child_sessions: false`.

## How it works

The plugin uses `ctx.permission.hook("evaluate")` with this sequence.

1. **Examine the action**: Handle only OpenCode decisions of `ask` for actions outside `skip_actions`. Keep existing `allow` and `deny` decisions.
2. **Examine the mode**: In `off`, do no reviews. In `dry-run` and `auto`, examine dangerous patterns, then the cache. Use the model if necessary.
3. **Apply the result**: In `auto`, follow the review result and review policies. In `dry-run`, keep the original `ask`.
4. **Record the log**: Record an action only if it is eligible for review and the plugin evaluates it in `dry-run` / `auto`.

### If a review fails

If a review fails, the plugin uses `on_failure` (default: `ask`). \
Even with invalid JSON, the review succeeds if the plugin can read an `allow` / `ask` / `deny` verdict from the response text. \
After 3 accumulated failures in model calls or output parsing, the plugin stops model reviews for 60 seconds. \
During this period, it still uses the cache. If the cache has no result, it applies `on_failure`. \
A successful verdict resets the failure count.

### Deny details (`explain_denials`)

If a configured OpenCode `deny` rule stops an action, the `permission` `evaluate` hook does not run. \
So the plugin examines the failed tool call in `tool.hook("execute.after")`. \
If the plugin can get the denied resources and the rules, it adds this data to the tool error message:

- The denied part of the command and the rule that matched
- The parts of the same call that no rule denied

For a command with pipes or `&&`, the model can see which part the rule denied. \
This function works in all modes (`off`, `dry-run`, `auto`) and does not change a permission decision. \
The added text is in English. \
Set `"explain_denials": false` to disable the function. \
If OpenCode does not give the denied resources, the plugin does not change the message.

This example shows the added message:

```text
Permission denied: shell
Denied resource: "rm -rf /tmp/x" (rule: "shell" "rm *" -> deny)
Not denied in the same call: "cat package.json", "grep foo"
The whole call did not run. Remove or change only the denied part before you retry.
```

### Information available to the model

The model uses this information for its decision.

- Action type
- Target resources
- Agent name
- Project directory
- Metadata

### Review results and banners

The model returns the reason (`reason`) and notes (`hint`) in the language set by `language` (default: `Japanese`). \
You can set `language` with a language code or natural language. \
Examples are `"Japanese"`, `"English"`, `"日本語"`, and `"英語"`. \
The plugin normalizes whitespace, removes whitespace at both ends, and uses the first 40 characters in the model instruction.

In `auto`, if the decision is `ask`, a banner above the input field shows the reason. \
If there is a hint, the banner also shows it. \
If a review fails and `on_failure` is `ask`, the banner shows the failure.

In `dry-run`, the banner shows:

- The `dry-run` label
- The proposed effect (`allow` / `ask` / `deny`) after review policies
- The reason and any hint

The plugin does not apply the proposed effect. It keeps the original `ask`. \
This also applies to dangerous pattern matches and review failures. \
Fixed messages for dangerous pattern decisions without the model and for review failures are in English, regardless of `language`.

### Banners for parent and child sessions, and display limitations

The parent session view can also show banners for pending requests in child and grandchild sessions. The target and heading follow these rules.

**The banner targets only the first request selected by this sequence.**

1. Examine the session currently on display.
2. Then examine descendant sessions in the order that OpenCode returns them.
3. Select the first request in the first non-empty pending queue.

If that request has no message from this plugin, no banner appears. \
Even if a later request has a review result, its banner does not appear.

**The heading identifies the session where the request originated.**

- A root session without a parent: `メイン` (the displayed label for Main)
- A descendant session: `agent name | session title`
- If information is unavailable: the agent ID (`Agent` if unknown) or session ID

Even if you open a child session directly, its own requests do not have the `メイン` label.

When approval or rejection removes the target request from the queue, its banner also disappears. \
If there is another target request, the banner changes to that request.

The banner reproduces the order of OpenCode's pending queues. \
No public API is available to get the request that the user currently selects in the confirmation view directly. \
The banner cannot guarantee a match if OpenCode changes its display order or a view shows a request other than the first.

### Model selection order

The `model` option determines model selection.

1. **If `model` specifies a fixed model (`provider/model`)**:
   - Always use that fixed model. Do not consult the session model.
2. **If `model` is absent or `"session"` (default)**:
   - **Priority 1**: Use the model of the current session.
   - **Priority 2**: If session information does not supply a model, use the OpenCode default model.
3. **If none of these methods supplies a model**:
   - Treat the review as a failure and apply `on_failure` (default: `ask`).

A fixed model uses `variant` (default: `low`). The value `none` omits it. \
A session model uses the session's variant. \
A fallback to the OpenCode default model does not include a variant. \
If a call with a variant fails, the plugin retries once without a variant.

The plugin caches session model information for 60 seconds after retrieval. \
A large model can increase cost and response time.

## Review policies

These options set the response to model review results and exceptional conditions. \
TUI commands do not change these values.

| Option       | Condition                                                   | Available values | Default |
| :----------- | :---------------------------------------------------------- | :--------------- | :------ |
| `on_danger`  | The model identifies danger, or a dangerous pattern matches | `ask` or `deny`  | `deny`  |
| `on_ask`     | The model recommends user confirmation                      | `ask` or `deny`  | `ask`   |
| `on_failure` | Review failure, timeout, invalid output, or no model found  | `ask` or `deny`  | `ask`   |

- `ask` shows the user confirmation dialog. `deny` blocks the action.
- If `on_ask` or `on_failure` is `deny`, even valid actions are blocked without confirmation. Use this only for fully automated workers without user interaction.

## TUI commands

Enter these commands in the terminal (TUI). \
Mode commands change the explicit mode of the current session. \
Inheritance is enabled by default, so the mode also applies to descendant sessions without their own explicit mode.

| Command                    | Description                                                    |
| :------------------------- | :------------------------------------------------------------- |
| `/permission-gate`         | Show the action menu.                                          |
| `/permission-gate-status`  | Show the current status in a dialog.                           |
| `/permission-gate-auto`    | Set `auto` mode for the current session.                       |
| `/permission-gate-dry-run` | Set `dry-run` mode for the current session.                    |
| `/permission-gate-off`     | Set `off` mode for the current session.                        |
| `/permission-gate-toggle`  | Switch from `auto` to `off`, or from any other mode to `auto`. |
| `/permission-gate-reset`   | Remove the session's explicit mode.                            |

After `reset`, mode selection uses the nearest ancestor's explicit mode if inheritance is enabled, then `auto_agents`, then the global `mode`. \
However, the `status` display and the source mode for `toggle` do not consult `auto_agents`. \
If neither the session nor an eligible ancestor has an explicit mode, they use the global mode. \
Thus, they can differ from the mode used for actual reviews.

Other clients can use the RPC method `permission-gate.run`. \
Set `text` to `auto`, `dry-run`, `off`, `toggle`, `status`, or `reset`. \
To change or remove an explicit mode, supply `sessionID`.

## Configuration options

| Option                      | Default                                                                        | Description                                                                                                                                         |
| :-------------------------- | :----------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`                      | `off`                                                                          | Global default mode (`off` / `dry-run` / `auto`).                                                                                                   |
| `model`                     | `session`                                                                      | Model for reviews. Use `session` for the current session model, or specify a model as `provider/model`.                                             |
| `variant`                   | `low`                                                                          | Variant for a directly specified model. Use `none` to omit it.                                                                                      |
| `timeout_ms`                | `2500`                                                                         | Maximum wait for one model generation request, in milliseconds. Minimum: `500`.                                                                     |
| `on_danger`                 | `deny`                                                                         | Response to actions identified as dangerous (`ask` / `deny`).                                                                                       |
| `on_ask`                    | `ask`                                                                          | Response to actions for which the model recommends user confirmation (`ask` / `deny`).                                                              |
| `on_failure`                | `ask`                                                                          | Response to review failures (`ask` / `deny`).                                                                                                       |
| `explain_denials`           | `true`                                                                         | Add the denied part of the command and the rule that matched to the tool error when a configured OpenCode rule denies an action.                     |
| `language`                  | `Japanese`                                                                     | Language for `reason` and `hint`. No specific format is necessary. Natural-language values include English (`"English"`) and Japanese (`"日本語"`). |
| `cache_ttl_ms`              | `600000`                                                                       | Time to reuse a decision, in milliseconds (default: 10 minutes). Minimum: `1000`.                                                                   |
| `audit_path`                | `~/.local/share/opencode/permission-gate.jsonl` (if `$XDG_DATA_HOME` is unset) | Audit log file. For a custom value in the configuration file, use an absolute path. The plugin does not expand `~`.                                 |
| `auto_agents`               | `[]`                                                                           | Array of agent names that use `auto` if neither the session nor an eligible ancestor has an explicit mode.                                          |
| `inherit_to_child_sessions` | `true`                                                                         | Descendant sessions consult ancestors' explicit modes. Set `false` to disable inheritance. An absent or non-boolean value uses the default.         |
| `skip_actions`              | `["question","external_directory","subagent"]`                                 | Action names excluded from reviews. A non-empty array replaces the defaults. An empty array restores the defaults.                                  |
| `force_ask_patterns`        | `[]`                                                                           | Array of regular expressions added to built-in dangerous patterns. A match applies `on_danger` without a model call.                                |

If `audit_path` is absent and `$XDG_DATA_HOME` is set, the log path is `$XDG_DATA_HOME/opencode/permission-gate.jsonl`.

### Dangerous patterns and excluded actions

`force_ask_patterns` is case-insensitive. The plugin ignores invalid regular expressions. \
Although the name includes `ask`, this option does not make user confirmation mandatory. \
In `dry-run`, a match still keeps the original `ask`.

Dangerous patterns match against a string of `resources` joined with newlines. \
The plugin evaluates patterns before the cache or model. A match applies `on_danger` without a model call. \
An empty array of additional patterns does not disable built-in patterns.

The default `subagent` entry in `skip_actions` excludes only the action that starts a subagent. \
It does not exclude all commands in child sessions. \
Child actions also receive reviews according to their action names and modes.

### Decision cache

The decision cache reuses results by the combination of project directory, `action`, `resources`, `agent`, and `metadata.cwd`. \
The key does not include `sessionID`, the model, or file contents. \
Sessions with the same key reuse results, even across different sessions. \
A change only to files or the model does not cause a new review.

### Configuration example with all options

You can omit options that you do not need.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "github:fateshelled/opencode-permission-gate",
      "options": {
        "mode": "off",                                           // "off" | "dry-run" | "auto"
        "model": "session",                                      // "session" | "provider/model"
        "variant": "low",                                        // Fixed model only: model-specific variant (default: "low"); "none" omits it.
        "timeout_ms": 2500,                                      // Milliseconds; minimum: 500.
        "on_danger": "deny",                                     // "ask" | "deny"
        "on_ask": "ask",                                         // "ask" | "deny"
        "on_failure": "ask",                                     // "ask" | "deny"
        "explain_denials": true,                                 // true | false
        "language": "Japanese",                                  // Any language name or code.
        "cache_ttl_ms": 600000,                                  // Milliseconds; minimum: 1000.
        "audit_path": "/absolute/path/to/permission-gate.jsonl", // Absolute path; no "~" expansion.
        "auto_agents": ["worker"],
        "inherit_to_child_sessions": true,                       // true | false
        "skip_actions": ["question", "external_directory", "subagent"],
        "force_ask_patterns": ["\\bterraform\\s+destroy\\b", "\\bkubectl\\s+delete\\b"]
      }
    }
  ]
}
```

A configuration example for a local clone is in `examples/opencode.jsonc`.

### Automatic decisions for specific agents (`auto_agents`)

In `auto_agents`, list agent names that you want to review in `auto`. \
This applies if neither the session nor an eligible ancestor has an explicit mode. \
You can use it to automate background workers and subagents.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "github:fateshelled/opencode-permission-gate",
      "options": {
        "mode": "off",
        "auto_agents": ["worker"]
      }
    }
  ]
}
```

Mode selection uses this priority order.

1. A command that sets the session's own explicit mode (such as `/permission-gate-off`)
2. The nearest ancestor's explicit mode from a command (enabled by default; disabled with `inherit_to_child_sessions: false`)
3. Automatic mode from an `auto_agents` match for the agent name of the current action
4. The global `mode`

### Mode inheritance by descendant sessions (`inherit_to_child_sessions`)

By default, child and grandchild sessions consult the nearest ancestor's explicit mode. \
The setting is `"inherit_to_child_sessions": true`.

- If you run `/permission-gate-auto` in a parent, descendants without their own explicit mode also use `auto`.
- A child's explicit `off` or `dry-run` takes priority over the parent and also applies to that child's descendants.
- A parent's mode change or `reset` takes effect at the next mode lookup.
- The plugin does not copy modes to children, so each child's own explicit mode stays intact.
- Inheritance covers explicit `auto`, `off`, and `dry-run` modes. It does not cover an ancestor's automatic mode from `auto_agents`.

To disable inheritance, set `"inherit_to_child_sessions": false` in the plugin's `options`. \
The plugin then does not consult ancestors and keeps the previous priority order. \
An absent or non-boolean value uses `true`.

If parent information is unavailable or the plugin detects a cycle, it stops the ancestor search. \
It then evaluates `auto_agents` for the current action, followed by the global setting.

`auto_agents` changes only the mode. \
It does not affect the specified model, `timeout_ms`, `on_danger`, other settings, or explicit `deny` rules.

## Examine the audit log

The plugin records actions that meet all these conditions.

- The original decision is `ask`.
- The action name is outside `skip_actions`.
- The mode is `dry-run` or `auto`.

It does not record actions in `off` or excluded actions. \
In `dry-run`, `effect` is the proposed effect after review policies, not an actual applied decision. \
Each line is a JSON object such as this.

```json
{"at":"...","mode":"auto","session":"ses_...","agent":"worker","action":"shell","resources":["git status"],"effect":"allow","reason":"read only"}
```

For initial use, operate in `dry-run` mode. Examine the log to make sure that decisions match your intent.

## Security notes

- **Limits on script inspection**: The model reviews the command string itself. It does not examine internal files of the target script and can miss indirect risks.
- **Use the shell scanner**: Keep OpenCode's shell scanner enabled. Do not disable it.
- **Do not depend only on LLM decisions**: Also use dangerous patterns and OpenCode permission rules. The prompt instructs the model to permit only actions within the project. However, this plugin does not enforce access boundaries.
- **Isolated environments are recommended**: An LLM can make incorrect decisions. We recommend `auto` only in isolated execution environments, such as containers.

**This plugin is not a sandbox.** \
A worktree separates work files. It does not isolate the OS, processes, or network.

## Development and tests

The plugin source is TypeScript. OpenCode loads and runs it directly. \
For development type checks, use these commands.

```sh
bun install
bun run typecheck
```

Tests use `node:test`. \
With Node.js and npm available, use this command. It fetches `tsx` if `tsx` is not installed.

```sh
npx --yes tsx --test tests/*.test.ts
```

Automated tests cover:

- Mode inheritance
- Proposed effects in `dry-run`
- Banner target selection and headings
- Deny details

Automated tests do not cover actual TUI rendering or agreement with OpenCode's confirmation view. \
Do these manual checks.

- Examine the headings in both parent and child session views.
- Make sure that no later banner appears while an ordinary permission request is first in the queue.
- Process the first request. Make sure that the banner switches to the next target.

## License

MIT
