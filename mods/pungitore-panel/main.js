// The to-do panel.
//
// Two lists, both about the space in front:
//
//   * the repository's own to-dos, read from its TODO.md — the truth the agent
//     works from (ADR-0005), mirrored here so it can be seen and started;
//   * the quick to-dos the person typed by hand, which wait to be turned into
//     a deeper to-do in a session and then written into the repository.
//
// A to-do is a message to an agent, so it is not sent on a click: it opens in
// a dialog, where it can be read, changed, and only then sent as the first
// message of a new session.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import {
  spaces, agents, panes, focused, readTextFile, theme, openOverlay, checking, home,
  shared, setShared,
} from "herdr";

const MAX_TODOS = 6;
const OPEN = /^\s*[-*]\s+\[ \]\s+(.*\S)\s*$/;
const DONE = /^\s*[-*]\s+\[[xX]\]/;

// The quick to-dos live in the store the notes dialog used, so what was
// written there before is still here: a space's list is its list.
const QUICK = "herdr.notes";

// The colours a space wears in the sidebar. The same names, the same hexes:
// the panel says which space it is showing, in the colour that space wears.
const MARK = {
  ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def",
  ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a",
};

const STATE_COLOR = {
  working: "working",
  blocked: "blocked",
  done: "done",
  idle: "idle",
  error: "blocked",
};

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function parseTodos(text) {
  const open = [];
  let done = 0;
  for (const line of text.split("\n")) {
    const match = OPEN.exec(line);
    if (match) {
      open.push(match[1]);
      continue;
    }
    if (DONE.test(line)) done += 1;
  }
  return { open, done };
}

// The name of the repository: the last segment of the folder it lives in.
function repoName(folder) {
  const parts = String(folder).split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "~";
}

// The colour the space wears in the sidebar, so the panel says the same thing
// the sidebar says: this block is that space.
function spaceColor(t, id) {
  const c = (shared("space.colors") ?? {})[id] ?? "ansi6";
  return c.startsWith("#") ? c : (MARK[c] ?? t[c] ?? t.dim);
}

// The directory above this one.
function parentOf(dir) {
  const trimmed = String(dir).replace(/\/+$/, "");
  const at = trimmed.lastIndexOf("/");
  if (at < 0) return null;
  if (at === 0) return "/";
  return trimmed.slice(0, at);
}

// The space the window is showing, and where its work is.
//
// A space's folder is where its *next* terminal starts, which goes stale as
// soon as a terminal moves: a space named for one repository whose terminal
// sits in another points at the wrong repository, and the panel then mirrors
// a repository nobody is in. The space that is shown is the one the sidebar
// has selected, and the folder that is true is the one the terminal in it is
// in.
function current() {
  const all = spaces();
  const focus = focused();
  const space =
    all.find((s) => s.active) ??
    (focus ? all.find((s) => s.id === focus.space) : null) ??
    null;
  if (!space) return null;

  const tab = space.tabs?.find((t) => t.active) ?? null;
  const shown = tab ? panes().filter((p) => p.tab === tab.id) : [];
  const pane = shown.find((p) => p.focused) ?? shown.find((p) => p.cwd) ?? null;

  // The focused terminal counts only when it belongs to the shown space: the
  // focus can still be sitting in the space the person just left.
  const mine = focus && focus.space === space.id ? focus : null;
  const folder = mine?.cwd || pane?.cwd || space.folder || null;
  const branch = pane?.branch || space.branch || null;
  return { space, folder, branch };
}

// The repository's TODO.md is canonical. It sits at the root of the
// repository, which is not always the folder the terminal is in, so the
// search walks up and takes the first one it finds.
async function findTodos(folder, machine) {
  const here = home();
  let dir = folder;
  for (;;) {
    let text = null;
    try {
      text = await readTextFile(`${dir}/TODO.md`, { on: machine ?? null });
    } catch {
      // A machine that cannot be reached has nothing to show.
      text = null;
    }
    if (text !== null && text !== undefined) {
      return { folder: dir, ...parseTodos(text) };
    }
    if (!dir || dir === here) break;
    const up = parentOf(dir);
    if (!up || up === dir) break;
    dir = up;
  }
  return { folder, open: [], done: 0, missing: true };
}

// The quick to-dos of every space, as a copy: what is written back is what
// was changed.
function quickStore() {
  const v = shared(QUICK);
  const s = v && typeof v === "object" ? v : {};
  const perSpace = {};
  for (const [id, list] of Object.entries(s.spaces ?? {})) {
    perSpace[id] = (list ?? []).map((i) => ({ ...i }));
  }
  return { global: (s.global ?? []).map((i) => ({ ...i })), spaces: perSpace };
}

export default class Pungitore extends View {
  init(_props, cx) {
    this.target = null;
    this.todos = { open: [], done: 0, missing: true };
    this.key = null;
    this.loading = false;
    this.typing = false;
    this.handle = cx.focus_handle();
    this.draft = InputState.new({ placeholder: "Add a to-do…" });
    this.draft.on("submit", (_e, cx) => this.addQuick(cx));
    this.draft.on("focus", (_e, cx) => {
      this.typing = true;
      cx.notify();
    });
    if (checking()) return;
    this.refresh(cx);
    // The file changes under us; the app's own data does not, and that arrives
    // by itself.
    cx.timer.every(5000, (cx) => this.refresh(cx));
  }

  // What the panel is looking at, as one string: the space and the folder it
  // works in. When it changes, the to-dos on screen belong to another
  // repository and have to be read again.
  static keyOf(here) {
    return here ? `${here.space.id}|${here.folder ?? ""}` : "none";
  }

  // The poll: the file changes under us, and the to-dos on screen move.
  async refresh(cx) {
    const here = current();
    this.key = Pungitore.keyOf(here);
    await this.load(cx, here);
  }

  // Reading the repository: its TODO.md.
  async load(cx, here) {
    const key = Pungitore.keyOf(here);
    const todos = here && here.folder
      ? await findTodos(here.folder, here.space.machine)
      : { folder: null, open: [], done: 0, missing: true };
    // The person moved on while the file was being read: what came back
    // belongs to a repository the panel is no longer showing.
    if (key !== this.key) return;
    // The repository is the folder the TODO.md was found in: the terminal may
    // sit in a directory below it.
    this.target = here ? { ...here, folder: todos.folder ?? here.folder } : null;
    this.todos = todos;
    this.loading = false;
    cx.notify();
  }

  // The agents working in the space, by status.
  agentsIn(spaceId) {
    if (!spaceId) return [];
    return agents().filter((a) => a.space === spaceId);
  }

  // A to-do is a message to an agent, so it is not sent on a click: the
  // to-do opens in a dialog where it can be read, changed, and only then
  // sent as the first message of a new session.
  confirm(space, folder, text, hint) {
    openOverlay({
      mod: "pungitore-confirm",
      kind: "dialog",
      width: 520,
      height: 260,
      props: { space: space.id, folder, name: repoName(folder), text, hint },
    });
  }

  // The agent's status is one word — working, blocked, done, idle — and its
  // title says which terminal it is.
  statusLine(t, agent) {
    const state = agent.status || "unknown";
    const color = t[STATE_COLOR[state] || "unknown"] || t.dim;
    const message = agent.title ? ` — ${agent.title}` : "";
    return h_flex()
      .gap(5)
      .items_center()
      .child(div().size(7).flex_none().rounded_full().bg(color))
      .child(
        div()
          .min_w(0)
          .truncate()
          .text_size(11)
          .text_color(t.muted)
          .child(`${state}${message}`),
      );
  }

  // The repository the space works in, and the to-dos it holds.
  spaceBlock(t, target, todos) {
    const here = this.agentsIn(target.space.id);
    // The colour the space wears in the sidebar: the panel says which space it
    // is showing, in the colour that space wears.
    const color = spaceColor(t, target.space.id);

    const header = h_flex()
      .id("pungitore-head")
      .gap(6)
      .items_center()
      .justify_between()
      .child(
        h_flex()
          .min_w(0)
          .gap(6)
          .items_center()
          .child(div().size(8).flex_none().rounded(2).bg(color))
          .child(
            div()
              .min_w(0)
              .truncate()
              .text_size(12)
              .font_semibold()
              .text_color(color)
              .child(repoName(target.folder)),
          ),
      )
      .when(target.branch, (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child(target.branch)));

    const list = this.loading
      ? [div().px(8).py(3).text_size(11).text_color(t.dim).child("reading…")]
      : todos.open.length
        ? todos.open.slice(0, MAX_TODOS).map((text, index) =>
            h_flex()
              .id(`pungitore-todo-${index}`)
              .gap(6)
              .px(8)
              .py(3)
              .rounded(5)
              .cursor_pointer()
              .hover((s) => s.bg(t.hover))
              .on_click(() => this.confirm(target.space, target.folder, text))
              .child(div().flex_none().text_size(11).text_color(index === 0 ? t.accent : t.dim).child(index === 0 ? "▶" : "·"))
              .child(
                div()
                  .min_w(0)
                  .text_size(11.5)
                  .text_color(index === 0 ? t.foreground : t.muted)
                  .child(text),
              ),
          )
        : [div().px(8).py(3).text_size(11).text_color(t.dim).child(todos.missing ? "no TODO.md" : "nothing to do")];

    return v_flex()
      .id("pungitore-space")
      .w_full()
      .gap(3)
      .py(6)
      .child(header)
      .children(here.map((agent) => this.statusLine(t, agent)))
      .children(list)
      .when(todos.open.length > MAX_TODOS, (el) =>
        el.child(div().px(8).text_size(10.5).text_color(t.dim).child(`+${todos.open.length - MAX_TODOS} more`)),
      )
      .when(todos.done > 0, (el) =>
        el.child(div().px(8).text_size(10.5).text_color(t.dim).child(`${todos.done} done`)),
      );
  }

  // The quick to-dos of the space in front: what the person typed by hand.
  quickList() {
    const id = this.target?.space?.id ?? null;
    if (!id) return [];
    return quickStore().spaces[id] ?? [];
  }

  writeQuick(list, cx) {
    const id = this.target?.space?.id ?? null;
    if (!id) return;
    const v = quickStore();
    v.spaces[id] = list;
    setShared(QUICK, v);
    cx.notify();
  }

  // A new quick to-do: it belongs to the space in front.
  addQuick(cx) {
    const text = this.draft.value().trim();
    const id = this.target?.space?.id ?? null;
    if (!text || !id) return;
    const v = quickStore();
    v.spaces[id] = [...(v.spaces[id] ?? []), { id: uid(), text, done: false }];
    setShared(QUICK, v);
    this.draft.set_value("");
    cx.notify();
  }

  toggleQuick(item, cx) {
    this.writeQuick(this.quickList().map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)), cx);
  }

  dropQuick(item, cx) {
    this.writeQuick(this.quickList().filter((i) => i.id !== item.id), cx);
  }

  // A quick to-do goes to a session, where it is refined and then written into
  // the repository's TODO.md. The dialog says so, so the agent is not left to
  // guess what the to-do is for.
  quickRow(t, item, target) {
    const box = h_flex()
      .id(`quick-box-${item.id}`)
      .w(16)
      .flex_none()
      .justify_center()
      .items_center()
      .cursor_pointer()
      .child(
        div()
          .size(11)
          .rounded(3)
          .border_1()
          .border_color(item.done ? t.done : t.border)
          .bg(item.done ? t.done : t.popover)
          .when(item.done, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(8).text_color(t.background))),
      );
    return h_flex()
      .id(`quick-${item.id}`)
      .min_h(28)
      .px(8)
      .gap(8)
      .rounded(6)
      .items_center()
      .hover((s) => s.bg(t.hover))
      .child(box.on_click((_e, cx) => this.toggleQuick(item, cx)))
      .child(
        h_flex()
          .flex_1()
          .min_w(0)
          .items_center()
          .cursor_pointer()
          .on_click((_e, cx) =>
            this.confirm(
              target.space,
              target.folder,
              item.text,
              "The session refines this to-do and writes it into this repository's TODO.md.",
            ),
          )
          .child(
            div()
              .flex_1()
              .truncate()
              .text_size(11.5)
              .text_color(item.done ? t.dim : t.foreground)
              .child(item.text),
          ),
      )
      .child(
        h_flex()
          .id(`quick-drop-${item.id}`)
          .w(18)
          .flex_none()
          .justify_center()
          .items_center()
          .cursor_pointer()
          .opacity(0.5)
          .hover((s) => s.opacity(1).text_color(t.blocked))
          .on_click((_e, cx) => this.dropQuick(item, cx))
          .child(svg("mods/workspace-chrome/x.svg").size(11)),
      );
  }

  // The second list: the quick to-dos, and the field that writes one.
  quickBlock(t, target) {
    const list = this.quickList();
    return v_flex()
      .id("pungitore-quick")
      .w_full()
      .gap(3)
      .py(6)
      .child(
        h_flex()
          .items_center()
          .gap(8)
          .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child("Quick to-dos"))
          .child(div().flex_1())
          .child(div().text_size(10.5).text_color(t.dim).child("yours, kept in Herdr")),
      )
      .children(
        list.length
          ? list.map((item) => this.quickRow(t, item, target))
          : [div().px(8).py(3).text_size(11).text_color(t.dim).child("None yet — write one below.")],
      )
      .child(
        h_flex()
          .id("quick-add")
          .h(30)
          .px(9)
          .flex_1()
          .items_center()
          .rounded(8)
          .border_1()
          .border_color(this.typing ? t.accent : t.input)
          .bg(t.background)
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(Input.new(this.draft).flex_1().h_full().text_size(12).text_color(t.foreground)),
      );
  }

  render(cx) {
    const t = theme();
    // Herdr redraws the mod when its live data changes — a space switched, a
    // terminal moved. The to-dos are ours to read, so they are read at once:
    // waiting for the next poll would leave the panel showing the repository
    // the person just left, for up to five seconds.
    const here = current();
    const key = Pungitore.keyOf(here);
    if (key !== this.key) {
      this.key = key;
      this.loading = true;
      this.todos = { open: [], done: 0, missing: true };
      cx.timer.after(0, (cx) => this.load(cx, here));
    }
    const target = this.target;

    const title = h_flex()
      .id("pungitore-title")
      .px(4)
      .pb(2)
      .gap(6)
      .items_center()
      .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child("To-dos"));

    const body = target && target.folder
      ? [
          v_flex()
            .id("pungitore-repository")
            .w_full()
            .gap(3)
            .child(
              h_flex()
                .items_center()
                .gap(8)
                .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child("This repository"))
                .child(div().flex_1()),
            )
            .child(this.spaceBlock(t, target, this.todos)),
          this.quickBlock(t, target),
        ]
      : [
          div().px(4).py(6).text_size(11.5).text_color(t.dim).child("No space is shown."),
        ];

    return v_flex()
      .id("pungitore-root")
      .size_full()
      .min_h(0)
      .bg(t.surface)
      .overflow_y_scrollbar()
      .p(8)
      .gap(2)
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.typing) {
          this.typing = false;
          this.handle.focus();
          cx.stop_propagation();
        }
      })
      .child(title)
      .children(body);
  }
}
