import { Plugin } from "@opencode/plugin/tui"
import { jsx, jsxs } from "@opentui/solid/jsx-runtime"
import { createEffect, createMemo, Show } from "solid-js"
import { PermissionGate } from "./rpc"

type MenuOption = {
  title: string
  value: string
  description?: string
  category?: string
}

const SESSION_MENU: MenuOption[] = [
  { title: "Status", value: "status", description: "Show the current mode", category: "State" },
  { title: "Auto", value: "auto", description: "Judge and apply ask decisions", category: "Session" },
  { title: "Dry-run", value: "dry-run", description: "Log decisions only", category: "Session" },
  { title: "Off", value: "off", description: "Do not judge", category: "Session" },
  { title: "Toggle", value: "toggle", description: "Switch between auto and off", category: "Session" },
  { title: "Reset", value: "reset", description: "Remove the session override", category: "Session" },
]

const ACTIONS = [
  { suffix: "status", title: "Permission gate: status", action: "status" },
  { suffix: "auto", title: "Permission gate: auto (session)", action: "auto" },
  { suffix: "dry-run", title: "Permission gate: dry-run (session)", action: "dry-run" },
  { suffix: "off", title: "Permission gate: off (session)", action: "off" },
  { suffix: "toggle", title: "Permission gate: toggle (session)", action: "toggle" },
  { suffix: "reset", title: "Permission gate: reset (session)", action: "reset" },
]

function splitMessage(message: string): { reason: string; hint: string } {
  const body = message.replace(/^permission-gate:\s*/, "")
  const index = body.indexOf(" | ")
  if (index < 0) {
    return { reason: body, hint: "" }
  }
  return { reason: body.slice(0, index), hint: body.slice(index + 3) }
}

export default Plugin.define({
  id: "permission-gate.tui",
  setup(context) {
    const currentSessionID = (): string | undefined => {
      const route = context.ui.router.current() as any
      return route?.type === "session" ? route.sessionID : undefined
    }

    const runAction = async (action: string): Promise<void> => {
      try {
        const result = (await context.client.rpc(PermissionGate).run({
          text: action,
          sessionID: currentSessionID(),
        })) as { message: string; ok: boolean }

        if (!result.ok) {
          context.ui.toast.show({
            title: "permission-gate",
            message: result.message,
            variant: "error",
            duration: 7000,
          })
          return
        }

        if (action === "status") {
          await context.ui.dialog.alert({
            title: "permission-gate",
            message: result.message,
          })
          return
        }

        context.ui.toast.show({
          title: "permission-gate",
          message: result.message,
          variant: "success",
          duration: 3000,
        })
      } catch (error) {
        context.ui.toast.show({
          title: "permission-gate",
          message: String(error),
          variant: "error",
          duration: 7000,
        })
      }
    }

    const showMenu = async (options: MenuOption[]): Promise<void> => {
      const value = await context.ui.dialog.select({
        title: "Permission gate",
        options: options as any,
      })
      if (!value) {
        return
      }
      await runAction(value)
    }

    const PermissionBanner = (props: { sessionID: string }) => {
      createEffect(() => {
        void context.data.session.permission.sync(props.sessionID)
      })

      const message = createMemo(() => {
        const requests = context.data.session.permission.list(props.sessionID) ?? []
        return requests
          .map((request) => request.message)
          .find((value): value is string => !!value?.startsWith("permission-gate:")) ?? ""
      })
      const parts = createMemo(() => splitMessage(message()))

      const banner = () =>
        jsxs("box", {
          border: true,
          borderStyle: "rounded",
          borderColor: context.theme.text.feedback.warning.base,
          backgroundColor: context.theme.background.feedback.warning.base,
          title: "permission-gate",
          titleAlignment: "left",
          paddingX: 1,
          marginTop: 1,
          get children() {
            return jsxs("text", {
              fg: context.theme.text.feedback.warning.base,
              get children() {
                return [
                  jsx("b", {
                    get children() {
                      return parts().reason
                    },
                  }),
                  jsx("span", {
                    get children() {
                      return parts().hint ? ` ${parts().hint}` : ""
                    },
                  }),
                ]
              },
            })
          },
        })

      return jsx(Show as any, {
        get when() {
          return message()
        },
        get children() {
          return banner()
        },
      })
    }

    const removeBanner = context.ui.slot({
      append: "session.composer.top",
      render: ({ sessionID }) => jsx(PermissionBanner as any, { sessionID }),
    })

    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [
        {
          id: "permission-gate.menu",
          title: "Permission gate",
          group: "Permission gate",
          palette: true,
          slash: { name: "permission-gate" },
          run: () => showMenu(SESSION_MENU),
        },
        ...ACTIONS.map((command) => ({
          id: `permission-gate.${command.suffix}`,
          title: command.title,
          group: "Permission gate",
          palette: true,
          slash: { name: `permission-gate-${command.suffix}` },
          run: () => runAction(command.action),
        })),
      ],
    }))

    return () => {
      removeBanner()
    }
  },
})
