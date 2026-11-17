// Context menus (Herdr's items). Opened as a popup with
// props { tab: "pane" | "tab" | "space" | "global", target }.
// ↑/↓ move, Enter runs, Esc closes. An item is [label, command, args];
// a command "worktree" opens the worktree dialog instead.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, terminals, spaces, panes, exec, shared, setShared, notify } from "herdr";

// The spaces that must not be closed by accident.
const PINNED = "herdr.pinned";

const pinned = (id) => (shared(PINNED) ?? []).includes(id);

function togglePin(id) {
  const list = shared(PINNED) ?? [];
  setShared(PINNED, list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
}

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

function items(p, git) {
  p = p ?? {};
  const tg = p.target ?? {};
  switch (p.tab) {
    case "pane": {
      // A kept sub-agent can go back under its parent, still running.
      const all = terminals();
      const term = all.find((t) => t.address === tg.terminal);
      const parent = term?.parent && all.find((t) => t.address === term.parent);
      // Once they go to the program, Shift+right-click still opens this menu.
      const toProgram = term?.labels?.["herdr.right-click"] === "program";
      // A terminal shown outside a tab (a layout terminal block, a window) has
      // no pane to split, zoom or close: its pane is the block's id.
      const inTab = panes().some((pane) => pane.pane === tg.pane);
      return [
        ...(inTab
          ? [
              ["Split right", "pane.split", { direction: "right", pane: tg.pane }],
              ["Split down", "pane.split", { direction: "down", pane: tg.pane }],
              ["Zoom", "pane.zoom", { pane: tg.pane }],
            ]
          : []),
        ...(term
          ? [
              toProgram
                ? ["Use Herdr right-click menu", "terminal.right_click", { terminal: term.address, to: "menu" }]
                : ["Send right-clicks to pane", "terminal.right_click", { terminal: term.address, to: "program" }],
            ]
          : []),
        ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address }]] : []),
        ...(inTab ? [["Close pane", "pane.close", { pane: tg.pane }]] : []),
      ];
    }
    case "tab":
      return [
        ["Rename", "tab.rename", { id: tg.id }],
        ["New tab", "tab.new", { space: tg.space }],
        ["Close", "tab.close", { id: tg.id }],
      ];
    case "space": {
      const id = tg.id;
      const isPinned = pinned(id);
      return [
        ["Rename", "space.rename", { id }],
        ...(git ? [["New worktree", "worktree", { space: id, action: "new" }], ["Open worktree", "worktree", { space: id, action: "open" }]] : []),
        ...(git === "linked" ? [["Remove worktree", "worktree", { space: id, action: "remove" }]] : []),
        [isPinned ? "Unpin space" : "Pin space", "herdr.pin", { id }],
        ["Icon and colour…", "herdr.look", { id }],
        ["Notes…", "herdr.notes", { id }],
        ["Claude (no permissions)", "herdr.claude", { id }],
        isPinned ? ["Close (pinned — unpin first)", "herdr.pinned.close", { id }] : ["Close", "space.close", { id }],
      ];
    }
    default:
      return [
        ["New space", "space.new", {}],
        ["Keybinds", "app.help", {}],
        ["Theme: default", "app.theme", { name: "atom-one-dark" }],
        ["Theme: tron blue", "app.theme", { name: "tron-blue" }],
        ["Theme: tron orange", "app.theme", { name: "tron-orange" }],
        ["Theme: graphite", "app.theme", { name: "graphite" }],
        ["Theme: ink", "app.theme", { name: "ink" }],
        ["Theme: moss", "app.theme", { name: "moss" }],
        ["Pin every space", "herdr.pin.all", {}],
        ["Unpin every space", "herdr.unpin.all", {}],
      ];
  }
}

function menuIcon(command) {
  const mine = {
    "herdr.pin": "mods/workspace-chrome/pin.svg",
    "herdr.notes": "mods/workspace-chrome/file-text.svg",
    "herdr.claude": "mods/workspace-chrome/terminal.svg",
    "herdr.pin.all": "mods/workspace-chrome/pin.svg",
    "herdr.unpin.all": "mods/workspace-chrome/pin-off.svg",
    "herdr.look": "mods/herdr-dock/palette.svg",
  };
  if (mine[command]) return mine[command];
  const name = command.endsWith(".close") ? "x" : command.endsWith(".rename") ? "square-pen" : command.endsWith(".new") ? "plus" : command === "worktree" ? "git-branch" : command === "app.help" ? "terminal" : command === "app.theme" ? "settings" : command === "pane.split" ? "panel-right" : command === "pane.zoom" ? "square" : "terminal";
  return `mods/workspace-chrome/${name}.svg`;
}

// The key bound to a command, for the hint on the right.
function shortcut(name, args) {
  // `pane.split:right` binds pane.split with { direction: "right" }.
  const value = args && Object.values(args)[0];
  const k = keys().find((b) => b.section === "global" && (b.action === name || b.action === `${name}:${value}`));
  return k ? k.keys : "";
}

export default class Menu extends View {
  init(_props, cx) {
    this.at = 0;
    this.git = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const p = props();
    const space = p?.tab === "space" && spaces().find((s) => s.id === p.target?.id);
    const folder = space && place(space);
    if (folder)
      cx.spawn(async (cx) => {
        this.git = await checkout(folder, space.machine).catch(() => null);
        cx.notify();
      });
  }

  choose(i, cx) {
    const it = items(props(), this.git)[i];
    if (!it) return;
    const command = it[1];
    const args = it[2] ?? {};
    if (command === "herdr.pin") {
      togglePin(args.id);
      closeOverlay(props()?.overlay);
      cx.notify();
      return;
    }
    if (command === "herdr.pin.all" || command === "herdr.unpin.all") {
      setShared(PINNED, command === "herdr.pin.all" ? spaces().map((s) => s.id) : []);
      setShared("herdr.pinNew", command === "herdr.pin.all");
      closeOverlay(props()?.overlay);
      cx.notify();
      return;
    }
    if (command === "herdr.look") {
      closeOverlay(props()?.overlay);
      openOverlay({ mod: "herdr-look", kind: "dialog", width: 430, height: 600, props: { space: args.id } });
      return;
    }
    if (command === "herdr.notes") {
      closeOverlay(props()?.overlay);
      openOverlay({ mod: "herdr-notes", kind: "dialog", width: 480, height: 580, props: { space: args.id } });
      return;
    }
    if (command === "herdr.claude") {
      closeOverlay(props()?.overlay);
      run("tab.new", { name: "Claude", space: args.id, argv: ["claude", "--dangerously-skip-permissions"] });
      return;
    }
    if (command === "herdr.pinned.close") {
      notify({ title: "This space is pinned", body: "Unpin it first, then close it.", level: "warning" });
      return;
    }
    closeOverlay(props()?.overlay);
    if (command === "worktree") openOverlay({ mod: "worktree", kind: "dialog", ...(args.action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: args });
    else run(command, args);
  }

  render(cx) {
    const t = theme();
    const list = items(props(), this.git);
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(
        list.map((it, i) =>
          v_flex()
            .when(i > 0 && (it[1].endsWith(".close") || it[1] === "app.help" || (it[1] === "app.theme" && list[i - 1][1] !== "app.theme")), el => el.child(div().mx(7).my(4).h(1).bg(t.border)))
            .child(h_flex()
            .id(`mi-${i}`)
            .h(31)
            .px(8)
            .gap(9)
            .rounded(7)
            .items_center()
            .justify_between()
            .text_color(t.foreground)
            .when(i === this.at, (el) => el.bg(t.selected))
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.choose(i, cx))
            .child(svg(menuIcon(it[1])).size(14).flex_none().text_color(t.muted))
            .child(div().flex_1().child(it[0]))
            .child(div().text_size(11).text_color(t.dim).child(shortcut(it[1], it[2])))),
        ),
      );
  }
}
