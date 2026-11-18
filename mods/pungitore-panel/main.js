// The Pungitore panel.
//
// Shows the repository the shown space works in the way the workflow sees it:
// the open to-dos from its TODO.md, the branch it is on, and what the agents
// in it are doing. The first open to-do is the next action, and clicking it
// opens that to-do in a dialog, where it can be changed before it is sent as
// the first message of a new session.
//
// The repository's TODO.md is canonical. This panel only mirrors it, and it
// reads it directly so that the mirror cannot drift from the truth.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  spaces, agents, panes, focused, readTextFile, exec, theme, openOverlay, checking, home, shared,
} from "herdr";

const MAX_TODOS = 6;
const OPEN = /^\s*[-*]\s+\[ \]\s+(.*\S)\s*$/;
const DONE = /^\s*[-*]\s+\[[xX]\]/;

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

// How many candidate lessons are waiting to be promoted. The Learning Loop
// publishes the count in a marker comment, so it is read as a fact rather
// than by parsing another plugin's files: the marker is the contract, the
// directory it lives in is an accident of layout (ADR-0013).
async function pendingLessons() {
  const dir = `${home()}/.claude/plugins/data`;
  try {
    const result = await exec(
      "grep",
      ["-rhoE", "--include=*.md", "<!-- pungitore-learning: pending [0-9]+ -->", dir],
      { timeout: 5000 }
    );
    let total = 0;
    for (const line of String(result.stdout || "").split("\n")) {
      const match = /pending (\d+)/.exec(line);
      if (match) total += Number(match[1]);
    }
    return total;
  } catch {
    // A machine without the Learning Loop installed has nothing waiting.
    return 0;
  }
}

export default class Pungitore extends View {
  init(_props, cx) {
    this.target = null;
    this.todos = { open: [], done: 0, missing: true };
    this.pending = 0;
    this.key = null;
    this.loading = false;
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

  // The poll: the file changes under us, and the waiting count moves.
  async refresh(cx) {
    const here = current();
    this.key = Pungitore.keyOf(here);
    await this.load(cx, here, true);
  }

  // Reading the repository: its TODO.md, and — when the poll asks for it —
  // how many candidate lessons are waiting.
  async load(cx, here, withPending) {
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
    if (withPending) this.pending = await pendingLessons();
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
  confirm(space, folder, text) {
    openOverlay({
      mod: "pungitore-confirm",
      kind: "dialog",
      width: 520,
      height: 250,
      props: { space: space.id, folder, name: repoName(folder), text },
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
      cx.timer.after(0, (cx) => this.load(cx, here, false));
    }
    const target = this.target;

    const title = h_flex()
      .id("pungitore-title")
      .px(4)
      .pb(4)
      .gap(6)
      .items_center()
      .child(div().text_size(11).text_color(t.dim).child("Pungitore"))
      .when(
        this.pending > 0,
        (el) => el.child(div().flex_none().text_size(11).text_color(t.accent).child(`${this.pending} waiting`)),
      );

    const body = target && target.folder
      ? [this.spaceBlock(t, target, this.todos)]
      : [div().px(4).py(6).text_size(11.5).text_color(t.dim).child("No space is shown.")];

    return v_flex()
      .id("pungitore-root")
      .size_full()
      .bg(t.surface)
      .overflow_y_scrollbar()
      .p(8)
      .gap(2)
      .child(title)
      .children(body);
  }
}
