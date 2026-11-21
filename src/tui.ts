import { Plugin } from "@opencode/plugin/tui"
import { jsx, jsxs } from "@opentui/solid/jsx-runtime"
import { createEffect, createMemo, on, Show } from "solid-js"
import { bannerLabel, bannerRequest, permissionSessionIDs, splitMessage } from "./permission-banner"
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
  { title: "Dry-run", value: "dry-run", description: "Show and log proposals without applying them", category: "Session" },
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
        options,
      })
      if (!value) {
        return
      }
      await runAction(value)
    }

    const PermissionBanner = (props: { sessionID: string }) => {
      const sessionIDs = createMemo(() =>
        permissionSessionIDs(props.sessionID, context.data.session.family(props.sessionID)),
      )
      const syncedSessions = new Set<string>()
      createEffect(on(sessionIDs, (ids) => {
        const added = ids.filter((id) => !syncedSessions.has(id))
        for (const id of added) {
          syncedSessions.add(id)
        }
        void Promise.allSettled(added.flatMap((id) => [
          context.data.session.sync(id),
          context.data.session.permission.sync(id),
        ]))
      }))

      const request = createMemo(() => bannerRequest(
        sessionIDs(),
        (id) => context.data.session.permission.list(id),
      ))
      const syncedMessages = new Set<string>()
      const syncedAgents = new Set<string>()
      createEffect(on(() => {
        const selected = request()
        if (!selected) {
          return undefined
        }
        return {
          sessionID: selected.sessionID,
          location: context.data.session.get(selected.sessionID)?.location
            ?? context.location ?? context.data.location.default(),
        }
      }, (selected) => {
        if (!selected) {
          return
        }
        const jobs: Promise<void>[] = []
        if (!syncedMessages.has(selected.sessionID)) {
          syncedMessages.add(selected.sessionID)
          jobs.push(context.data.session.message.sync(selected.sessionID))
        }
        const locationKey = JSON.stringify(selected.location)
        if (!syncedAgents.has(locationKey)) {
          syncedAgents.add(locationKey)
          jobs.push(context.data.location.agent.sync(selected.location))
        }
        void Promise.allSettled(jobs)
      }))
      const label = createMemo(() => {
        const selected = request()
        return selected ? bannerLabel(context.data, selected) : ""
      })
      const message = createMemo(() => request()?.message ?? "")
      const parts = createMemo(() => splitMessage(message()))

      const banner = () =>
        jsxs("box", {
          border: true,
          borderStyle: "rounded",
          borderColor: context.theme.text.feedback.warning.base,
          backgroundColor: context.theme.background.feedback.warning.base,
          get title() {
            return `permission-gate · ${label()}`
          },
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
          palette: true as const,
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
