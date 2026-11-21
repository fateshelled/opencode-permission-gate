# opencode-permission-gate

[日本語](README.md) | English

An LLM-based permission gate for OpenCode V2. When OpenCode resolves a
permission decision to `ask`, the plugin asks an LLM to review the action. The
plugin then keeps `ask`, changes it to `allow`, or blocks it with `deny`.

## Features

- Reviews only `ask` decisions.
- An explicit `deny` rule stays final.
- Uses the model of the current session by default.
- Has `off`, `dry-run`, and `auto` modes.
- Reads the global mode and the dangerous-action effect from the configuration file.
- Can send a dangerous action to the user or block it.
- Writes one audit line for each decision.
- Adds TUI commands and a status dialog.

## Requirements

- OpenCode V2 with the V2 plugin API.
- A chat model that can answer a short JSON prompt.

## Install

### From GitHub

```sh
opencode plugin add github:fateshelled/opencode-permission-gate
```

### From a local clone

Clone the repository, then add the plugin directory to
`~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugins": [
    {
      "package": "/path/to/opencode-permission-gate",
      "options": {
        "mode": "off",
        "model": "session",
        "on_danger": "deny"
      }
    }
  ]
}
```

The path can be relative to the configuration file.

## Quick start

1. Set the mode to `dry-run`:

   ```text
   /permission-gate-dry-run
   ```

2. Run a command that needs permission.

3. Read the audit log:

   ```text
   ~/.local/share/opencode/permission-gate.jsonl
   ```

4. If the decisions are correct, set `auto`:

   ```text
   /permission-gate-auto
   ```

## How it works

The plugin registers `ctx.permission.hook("evaluate")`.

- OpenCode evaluates the configured rules first.
- An explicit `deny` is final, and the plugin does not change it.
- The plugin reviews only decisions that resolve to `ask`.
- If the model fails, times out, or returns invalid output, the decision stays
  `ask`.
- The plugin writes one JSON line for each decision to the audit log.

The model sees the action, the resources, the agent name, and the project
directory. It does not read the session transcript.

If the decision stays `ask`, the plugin shows the reason in a `permission-gate`
toast. Use the toast and the approval dialog to decide what to check. If the
model review fails, the toast also shows that condition.

### Model selection

The plugin uses this order:

1. The plugin uses the model of the current session by default.
2. If you set `model` to `provider/model`, the plugin uses that model.
3. Otherwise the plugin uses the OpenCode default model.
4. If no model is available, the decision stays `ask`.

The plugin reads the session model from the session and caches it for 60
seconds. A strong session model increases cost and latency.

## Modes

| Mode | Behavior |
| --- | --- |
| `off` | Do nothing. |
| `dry-run` | Review the action and write the audit log without changing the decision. |
| `auto` | Review the action and use the decision. |

The default is `off`. Set the global mode with the `mode` option. The plugin
reads this option when it starts and does not keep a separate global state.
The TUI commands change only the current session.

## Dangerous actions

Set `on_danger` in the configuration file to `ask` or `deny`. The TUI commands
do not change this value.

- `ask` sends the action to the user.
- `deny` blocks the action.

The setting applies to a model verdict of `deny` and to the built-in dangerous
patterns. The default is `deny`.

## Commands

Use these commands in the TUI. Each command changes the current session only.

| Command | Result |
| --- | --- |
| `/permission-gate` | Open the menu. |
| `/permission-gate-status` | Show the state in a dialog. |
| `/permission-gate-auto` | Use auto mode in this session. |
| `/permission-gate-dry-run` | Use dry-run mode in this session. |
| `/permission-gate-off` | Use off mode in this session. |
| `/permission-gate-toggle` | Switch between auto and off. |
| `/permission-gate-reset` | Remove the session override. |

Other clients can call the RPC method `permission-gate.run` with `text` and
`sessionID`.

## Configuration

| Option | Default | Meaning |
| --- | --- | --- |
| `mode` | `off` | Global mode. The plugin reads it when it starts. |
| `model` | `session` | `session` uses the session model, and `provider/model` sets a fixed model. |
| `variant` | `low` | Variant for an explicit `provider/model`. Use `none` to omit it. |
| `timeout_ms` | `2500` | Time limit for one review. |
| `on_danger` | `deny` | Effect for a dangerous verdict: `ask` or `deny`. |
| `cache_ttl_ms` | `600000` | Time to keep one decision in the cache. |
| `audit_path` | `$XDG_DATA_HOME/opencode/permission-gate.jsonl` | Audit log file. |
| `auto_agents` | `[]` | Agents that always use `auto`. A session override wins. |
| `skip_actions` | `["question","external_directory","subagent"]` | Actions that the plugin does not review. |
| `force_ask_patterns` | `[]` | Extra regular expressions that count as dangerous. |

`auto_agents` is useful for orchestration. Set the worker agent name here. Each
new worker session starts in `auto` mode.

## Audit log

Each line has this shape:

```json
{"at":"...","mode":"auto","session":"ses_...","agent":"worker","action":"shell","resources":["git status"],"effect":"allow","reason":"read only"}
```

Read the log after a worker run. Make sure that the decisions are correct. Use
`dry-run` mode first.

## Security notes

- The model sees the command text but not file contents, so it can miss a risk
  in a script that a command starts.
- Keep the shell scanner enabled.
- Keep the dangerous patterns and the project scope checks, and do not use the
  model as the only control.
- A decision can be wrong, so use `auto` mode only for workers in an isolated
  worktree.
- An LLM review is not a sandbox and does not isolate the process.

## Development

The plugin source is TypeScript. OpenCode loads it directly. Contributors can
run a type check:

```sh
bun install
bun run typecheck
```

## License

MIT
