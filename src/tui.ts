import { Plugin } from "@opencode/plugin/tui"
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

    const stopPermission = context.data.on("permission.asked", (event) => {
      const message = event.data.message
      if (!message?.startsWith("permission-gate:")) {
        return
      }
      context.ui.toast.show({
        title: "permission-gate",
        message,
        variant: "warning",
        duration: 15000,
        sessionID: event.data.sessionID,
      })
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
      stopPermission()
    }
  },
})
