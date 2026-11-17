// The Pungitore panel.
//
// Shows each space's repository the way the workflow sees it: the open to-dos
// from its TODO.md, the branch it is on, and what the agents in it are doing.
// The first open to-do is the next action, and clicking it opens that to-do
// in a dialog, where it can be changed before it is sent as the first message
// of a new session.
//
// The repository's TODO.md is canonical. This panel only mirrors it, and it
// reads it directly so that the mirror cannot drift from the truth.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, agents, exec, theme, openOverlay, checking } from "herdr";

const MAX_TODOS = 6;
const OPEN = /^\s*[-*]\s+\[ \]\s+(.*\S)\s*$/;
const DONE = /^\s*[-*]\s+\[[xX]\]/;

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

// The name of the repository a space works in. Herdr names a space after where
// its first terminal was, which goes stale as soon as that terminal moves, so
// the folder is the thing worth showing.
function repoName(folder) {
  const parts = String(folder).split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "~";
}

// The folder a space's terminals start in is the repository it shows. The
// to-do list is that folder's TODO.md.
async function readTodos(space) {
  const folder = space.folder;
  const on = space.machine ?? undefined;
  const result = await exec("cat", [`${folder}/TODO.md`], { cwd: folder, on, timeout: 5000 });
  if (result.code !== 0) return { open: [], done: 0, missing: true };
  return parseTodos(result.stdout || "");
}

export default class Pungitore extends View {
  init(_props, cx) {
    this.state = new Map();
    if (checking()) return;
    this.refresh(cx);
    // The file changes under us; the app's own data does not, and that arrives
    // by itself.
    cx.timer.every(5000, (cx) => this.refresh(cx));
  }

  async refresh(cx) {
    const next = new Map();
    for (const space of spaces()) {
      if (!space.folder) continue;
      try {
        const todos = await readTodos(space);
        next.set(space.id, { ...todos, branch: space.branch ?? null });
      } catch {
        // A space on a machine that cannot be reached has nothing to show.
        next.set(space.id, { open: [], done: 0, missing: true, branch: space.branch ?? null });
      }
    }
    this.state = next;
    cx.notify();
  }

  // The agents working in a space, by status.
  agentsIn(spaceId) {
    return agents().filter((a) => a.space === spaceId);
  }

  // A to-do is a message to an agent, so it is not sent on a click: the
  // to-do opens in a dialog where it can be read, changed, and only then
  // sent as the first message of a new session.
  confirm(space, text) {
    openOverlay({
      mod: "pungitore-confirm",
      kind: "dialog",
      width: 520,
      height: 250,
      props: { space: space.id, folder: space.folder, name: repoName(space.folder), text },
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

  spaceBlock(t, space) {
    const data = this.state.get(space.id) || { open: [], done: 0 };
    const here = this.agentsIn(space.id);

    const header = h_flex()
      .id(`pungitore-head-${space.id}`)
      .gap(6)
      .items_center()
      .justify_between()
      .child(
        div()
          .min_w(0)
          .truncate()
          .text_size(12)
          .font_semibold()
          .text_color(t.foreground)
          .child(repoName(space.folder)),
      )
      .when(data.branch, (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child(data.branch)));

    const todos = data.open.length
      ? data.open.slice(0, MAX_TODOS).map((text, index) =>
          h_flex()
            .id(`pungitore-todo-${space.id}-${index}`)
            .gap(6)
            .px(8)
            .py(3)
            .rounded(5)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover))
            .on_click(() => this.confirm(space, text))
            .child(div().flex_none().text_size(11).text_color(index === 0 ? t.accent : t.dim).child(index === 0 ? "▶" : "·"))
            .child(
              div()
                .min_w(0)
                .text_size(11.5)
                .text_color(index === 0 ? t.foreground : t.muted)
                .child(text),
            ),
        )
      : [div().px(8).py(3).text_size(11).text_color(t.dim).child(data.missing ? "no TODO.md" : "nothing to do")];

    return v_flex()
      .id(`pungitore-space-${space.id}`)
      .w_full()
      .gap(3)
      .py(6)
      .child(header)
      .children(here.map((agent) => this.statusLine(t, agent)))
      .children(todos)
      .when(data.open.length > MAX_TODOS, (el) =>
        el.child(div().px(8).text_size(10.5).text_color(t.dim).child(`+${data.open.length - MAX_TODOS} more`)),
      )
      .when(data.done > 0, (el) =>
        el.child(div().px(8).text_size(10.5).text_color(t.dim).child(`${data.done} done`)),
      );
  }

  render(cx) {
    const t = theme();
    const all = spaces().filter((space) => space.folder);
    const withTodos = all.filter((space) => (this.state.get(space.id) || {}).open?.length);

    return v_flex()
      .id("pungitore-root")
      .size_full()
      .bg(t.surface)
      .overflow_y_scrollbar()
      .p(8)
      .gap(2)
      .child(div().px(4).pb(4).text_size(11).text_color(t.dim).child("Pungitore"))
      .children(
        withTodos.length
          ? withTodos.map((space) => this.spaceBlock(t, space))
          : [div().px(4).py(6).text_size(11.5).text_color(t.dim).child("No open to-dos in any space.")],
      );
  }
}
