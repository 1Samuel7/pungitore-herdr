// Workspace spaces: stable colored avatars, worktrees under their checkout,
// grouped by machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind. The
// agents working in a space live under it, one row each, and can be closed
// from there without taking the space with them. Click to
// switch, right-click for its menu, drag to reorder.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { spaces, machines, panes, agents, terminals, focused, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window, layout } from "herdr";

// The spaces that must not be closed by accident.
const PINNED = "herdr.pinned";

const isPinned = (id) => (shared(PINNED) ?? []).includes(id);

function togglePin(id) {
  const list = shared(PINNED) ?? [];
  setShared(PINNED, list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
const RAIL_CELL = 32;
// A space's name and its git tail never shrink below this, so a short one ("api")
// stays readable instead of turning into an ellipsis next to a long branch.
const SIDE_MIN = 48;
const railCell = (el) => h_flex().flex_none().justify_center().child(el);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;
// Places looked at together (two git runs each). All at once, a few hundred spaces
// run out of the app's open files (256 when started from the Dock on macOS) or
// past a machine core's 16 running execs, and those spaces wait for FALLBACK.
const AT_ONCE = 6;

// Both runs, finished: a place isn't done while one of its runs still holds a slot.
async function both(a, b) {
  const done = await Promise.allSettled([a, b]);
  const failed = done.find((d) => d.status === "rejected");
  if (failed) throw failed.reason;
  return done.map((d) => d.value);
}

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// A colour with white mixed into it: the active row, and the row under the
// pointer, wear the space's colour a shade brighter than the rest.
function lighten(c, amount) {
  if (!/^#[0-9a-f]{6}$/i.test(c)) return c;
  const n = parseInt(c.slice(1), 16);
  const mix = (v) => Math.round(v + (255 - v) * amount);
  const out = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => mix(v).toString(16).padStart(2, "0"));
  return `#${out.join("")}`;
}

// A colour with black mixed into it: the ground the white letters stand on.
// The chosen colour is bright, and white on it does not read; deeper, it does.
function deepen(c, amount) {
  if (!/^#[0-9a-f]{6}$/i.test(c)) return c;
  const n = parseInt(c.slice(1), 16);
  const mix = (v) => Math.round(v * (1 - amount));
  const out = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => mix(v).toString(16).padStart(2, "0"));
  return `#${out.join("")}`;
}

// What a space wears: its colour and the icon that stands for it. Both are
// shared, so the spaces list, the agents list and the picker agree.
function spaceLook(t, id) {
  const c = (shared("space.colors") ?? {})[id] ?? "ansi6";
  const color = c.startsWith("#") ? c : (MARK[c] ?? t[c] ?? t.dim);
  const icon = (shared("herdr.spaceIcons") ?? {})[id] ?? "";
  return { color, icon };
}

// The icon of a space: an emoji, or one of Herdr's own glyphs.
function lookIcon(icon, size, color) {
  if (!icon) return null;
  if (icon.startsWith("svg:")) return svg(`mods/workspace-chrome/${icon.slice(4)}.svg`).size(size).flex_none().text_color(color);
  return div().flex_none().text_size(size).child(icon);
}

// How urgent an agent is: what needs the person comes first.
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

// What an agent puts before its title: a status glyph and the separator after
// it ("✦  Working"), and the blink of a codex mark.
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();

// The icon of a program: a one-colour glyph, or a picture in its own colours.
function pic(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// The state of an agent, as a mark: a spinner while it works, a bang when it
// needs the person, a ring when it is idle, a dot when it is done.
function mark(t, status) {
  if (status === "working") return svg("mods/workspace-chrome/spinner.svg").size(11).mx(1).flex_none().text_color(t.working).spin(900);
  if (status === "blocked") return div().size(13).flex_none().rounded(4).bg(t.blocked + "26").text_size(9.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
  if (status === "idle") return div().size(6).mx(2).flex_none().rounded_full().border(1.5).border_color(t.idle ?? t.dim);
  if (status === "done") return div().size(6).mx(2).flex_none().rounded_full().bg(t.done ?? t.dim);
  return div().size(6).mx(2).flex_none();
}

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Map(); // local repos' pending folder watches
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.hovered = null;
    this.scroll = ScrollHandle.new(); // the list's position: the active space is brought into view through it
    this.activeAt = -1; // the active space's place among the list's children (headers and rows), -1 when not drawn
    this.machines = [];
    try {
      this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
      if (!this.reconnecting || typeof this.reconnecting !== "object" || Array.isArray(this.reconnecting)) this.reconnecting = {};
      for (const state of Object.values(this.reconnecting)) state.busy = false;
    } catch { this.reconnecting = {}; }
    try { this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]")); } catch { this.folded = new Set(); }
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // Refresh only when the refs could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
    // The agents under the spaces move on their own: a status, a title.
    cx.timer.every(2000, (cx) => this.checkAgents(cx));
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) {
      if (this.shown.has(s.id)) continue;
      this.born[s.id] ??= now;
      this.newPin(s.id);
    }
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    for (const k of Object.keys(this.git)) if (!keys.has(k)) {
      delete this.git[k];
      delete this.checked[k];
      this.unsure.delete(k);
    }
    const repos = new Set(Object.values(this.git).filter(Boolean).map((g) => g.repo));
    for (const [repo, pending] of this.watching) if (!repos.has(JSON.stringify([null, repo]))) {
      this.watching.delete(repo);
      pending.cancel();
    }
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(AT_ONCE, keys.length) }, async () => {
          while (next < keys.length) await this.check(keys[next++], cx);
        }));
      }
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // Ref-only reads avoid scanning the worktree or waking its index watch.
      // Two reads: a folder name may itself contain a newline.
      const [r, common] = await both(
        exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], { cwd, on }),
        exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on }),
      );
      if (r.code !== 0 || common.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.code !== 0 ? r.stderr : common.stderr)) {
          this.unsure.add(key);
          this.git[key] ??= null;
        } else this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = r.stdout.replace(/\n$/, ""), repo = common.stdout.replace(/\n$/, "");
      const [branch, counts] = await both(
        exec("git", ["symbolic-ref", "-q", "HEAD"], { cwd, on }),
        exec("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd, on }),
      );
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const [ahead, behind] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
      const info = { name, branch: branch.code === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, "") : "(detached)", ahead, behind, repo: JSON.stringify([on, repo]), linked: repo !== `${top}/.git` };
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    const pending = watchFolder(repo);
    this.watching.set(repo, pending);
    cx.spawn(async (cx) => {
      let current = pending;
      try {
        for (;;) {
          await current;
          if (this.watching.get(repo) !== current) return;
          const mine = JSON.stringify([null, repo]);
          const keys = Object.keys(this.git).filter((k) => this.git[k]?.repo === mine);
          if (!keys.length) break;
          this.refreshGit(keys, cx);
          current = watchFolder(repo);
          this.watching.set(repo, current);
        }
      } catch {}
      if (this.watching.get(repo) === current) this.watching.delete(repo);
    });
  }

  // While every space is pinned, a space made later is pinned too.
  newPin(id) {
    if (!shared("herdr.pinNew")) return;
    const list = shared(PINNED) ?? [];
    if (list.includes(id)) return;
    setShared(PINNED, [...list, id]);
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "herdr-menu", kind: "popup", width: 230, height: 320, props: { tab: "space", target: { id: w.id } } });
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    // Simulate the batch so later indexes include earlier moves. An attempted
    // write can lose a sync conflict: allow the echo to settle before retrying.
    const order = sp.map(w => w.id);
    const target = out.map(r => r.w.id);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < out.length; i++) {
        const from = order.indexOf(out[i].w.id);
        if (from === i) continue;
        run("space.move", { id: out[i].w.id, index: i + 1 });
        moved.add(out[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    return out.filter(r => this.shown.has(r.w.id));
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed) {
    const rows = this.ordered();
    const draw = (r) => (collapsed ? this.compact(r, t) : this.row(r, t));
    // Where the active space's row lands among the children this returns: the list scrolls by its direct
    // children, and machine headers, login notes and loading rows count too.
    this.activeAt = -1;
    let before = 0;
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => h_flex().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).items_center().when(collapsed, el => el.justify_center()).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    if (!remote.length) {
      if (loading(null) && !rows.length) return [loadingRow(null)];
      this.activeAt = rows.findIndex(r => r.w.active);
      return rows.map(draw);
    }
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const login = machine?.state === "needs_login" ? `hc machine login ${m}` : null;
      const folded = this.folded.has(m);
      const icon = svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none();
      const badge = div().absolute().right(-3).bottom(-2).size(6).rounded(3).border_1().border_color(t.chrome).bg(connected ? t.ansi2 : t.dim);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .when(collapsed, el => el.mt(4).w(RAIL_CELL).justify_center().rounded(6).tooltip(login ? `${m} needs a login: run ${login}. Click for Copy.` : m ? `${m} · ${connected ? "connected" : (machine?.state ?? "asleep").replace(/_/g, " ")}` : "This computer"))
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          if (collapsed && login) { run("app.settings", { section: "machines" }); return; }
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .when(machine?.keeps_running_after_logout === false, el => el.child(div().id(`machine-logout-${m}`)
          .flex_none().text_color(t.blocked).tooltip("Agents stop when you disconnect. Click for the fix.")
          .on_click((_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "machine-add", kind: "dialog", width: 560 }); }).child("⚠")))
        .when(!collapsed, el => el.child(icon))
        .when(collapsed, el => el.child(div().relative().flex_none().child(icon).when(Boolean(m), el => el.child(badge))))
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected && !rebuilt && !login, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .when(collapsed, el => el.w(RAIL_CELL).rounded(6).justify_center().tooltip(`New space on ${m ?? "this computer"}`)
          .child(h_flex().size(18).rounded(5).border_1().border_color(t.dim).items_center().justify_center()
            .child(svg("mods/workspace-chrome/plus.svg").size(10))))
        .when(!collapsed, el => el.child(svg("mods/workspace-chrome/plus.svg").size(12)).child("New space there"));
      if (!collapsed && rebuilt) { before += 1; return [head]; }
      const cell = collapsed ? railCell : (el) => el;
      const guidance = !collapsed && login ? [v_flex().px(8).pb(6).gap(3).flex_none()
        .child(div().text_size(11).text_color(t.blocked).child("needs a login: run"))
        .child(h_flex().gap(5).items_center()
          .child(div().flex_1().min_w(0).truncate().tooltip(login).text_size(11).text_color(t.muted).child(login))
          .child(div().id(`machine-login-copy-${m}`).flex_none().px(5).py(2).rounded(4)
            .text_size(11).text_color(t.foreground).bg(t.raised).cursor_pointer().hover(s => s.bg(t.hover))
            .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(login); this.copiedLogin = login; cx.notify(); })
            .child(this.copiedLogin === login ? "Copied" : "Copy")))] : [];
      const items = [cell(head), ...guidance, ...(folded ? [] : mine.length ? mine.map(draw) : [loading(m) ? loadingRow(m) : cell(empty)])];
      const first = folded ? -1 : mine.findIndex(r => r.w.active);
      if (first >= 0) this.activeAt = before + 1 + guidance.length + first;
      before += items.length;
      return items;
    });
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one. When the row is full, it
  // and the name both start from their text's width and give way in proportion.
  gitTail(g, tree, name, t, solid = false) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex()
      .flex_auto()
      .min_w(where ? SIDE_MIN : 0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(solid ? "#ffffffb8" : t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(solid ? "#ffffffe6" : t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(solid ? "#ffffffe6" : t.ansi1).child(`\u2193${g.behind}`)));
  }

  // A small button on a space row, shown while the pointer is on it.
  action(id, icon, tip, onClick, solid = false) {
    const t = theme();
    return h_flex()
      .id(id)
      .w(19)
      .flex_none()
      .justify_center()
      .items_center()
      .rounded(5)
      .cursor_pointer()
      .hover((s) => s.bg(solid ? "#ffffff33" : t.raised))
      .tooltip(tip)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        onClick(cx);
      })
      .child(svg(icon).size(12).flex_none().text_color(solid ? "#ffffffe0" : t.dim));
  }

  // The agents under the spaces change on their own. The list redraws when
  // what it shows has changed, and not before.
  checkAgents(cx) {
    const sig = JSON.stringify(agents().map((a) => [a.space, a.address, a.status, a.title, a.focused]));
    if (sig === this.agentSig) return;
    this.agentSig = sig;
    cx.notify();
  }

  // The agents working in a space, the ones needing the person first. A kept
  // sub-agent is in agents() too, but it belongs under the agent that spawned
  // it, not under the space.
  agentsOf(spaceId, all) {
    const parents = new Set(all.filter((t) => t.parent).map((t) => t.address));
    return agents()
      .filter((a) => a.space === spaceId && !parents.has(a.address))
      .sort((x, y) => (RANK[y.status] ?? 0) - (RANK[x.status] ?? 0) || (x.title ?? "").localeCompare(y.title ?? ""));
  }

  // Live sub-agents of an agent, depth first, each with the tree lines in
  // front of it.
  subTree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.subTree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  // What an agent's row says: the program it is, and the work it is on. The
  // work is what the agent reported as its title, when that says more than the
  // program's own name; else the name of the tab it works in.
  agentLabel(a) {
    const prog = a.program?.name ?? "Agent";
    const live = clean(a.title);
    const tab = this.tabs.get(a.tab);
    const named = tab?.named ? tab.name : null;
    const path = /^[~/]|^[A-Za-z]:\\/.test((a.title ?? "").replace(/^[^\p{L}\p{N}\/~]+/u, ""));
    const telling = live && live !== a.address && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== a.program?.key;
    const detail = telling ? live : named && named !== prog ? named : null;
    return { name: prog, detail };
  }

  // An agent under its space: what it is, what it is doing, and the way to
  // close it without taking the space with it.
  agentRow(t, space, a, last) {
    const label = this.agentLabel(a);
    const shown = focused()?.agent === a.address;
    const icon = pic(a.program, 13, t.muted);
    // Only an agent whose terminal we can see is ours to close.
    const closable = this.terminals.some((x) => x.address === a.address);
    const close = h_flex()
      .id(`agent-close-${a.address}`)
      .w(18)
      .flex_none()
      .justify_center()
      .items_center()
      .cursor_pointer()
      .opacity(0.5)
      .hover((s) => s.opacity(1).text_color(t.blocked))
      .tooltip("Close this agent. The space stays.")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.closeAgent(space, a);
      })
      .child(svg("mods/workspace-chrome/x.svg").size(11).flex_none().text_color(t.muted));
    return h_flex()
      .id(`agent-${a.address}`)
      .h(24)
      .pl(18)
      .pr(8)
      .gap(6)
      .items_center()
      .rounded(6)
      .when(shown, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("pane.focus", { pane: a.pane }))
      .child(div().w(9).flex_none().text_size(11).text_color(t.dim).child(last ? "└" : "├"))
      .when(Boolean(icon), (el) => el.child(icon))
      .child(div().flex_none().max_w(96).truncate().text_size(12).text_color(t.foreground).child(label.name))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(label.detail ? `· ${label.detail}` : ""))
      .child(mark(t, a.status))
      .when(closable, (el) => el.child(close));
  }

  // A kept sub-agent, under the agent that spawned it.
  subAgentRow(t, s) {
    const k = s.t;
    const status = k.status === "error" ? "blocked" : k.status === "done" ? "idle" : k.status;
    const shown = focused()?.agent === k.address;
    const icon = pic(k.program, 13, t.dim);
    return h_flex()
      .id(`sub-${k.address}`)
      .h(22)
      .pl(18)
      .pr(8)
      .gap(0)
      .items_center()
      .rounded(6)
      .when(shown, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => (this.listed.has(k.address) ? run("pane.focus", { terminal: k.address }) : run("terminal.peek", { terminal: k.address })))
      .children(
        s.lines.map((l) =>
          div()
            .self_start()
            .mt(-4)
            .w(9)
            .h(17)
            .mr(4)
            .flex_none()
            .when(Boolean(l), (el) => el.border_l(1.5).border_color(t.input))
            .when(l === "└" || l === "├", (el) => el.border_b(1.5).rounded_bl(6)),
        ),
      )
      .when(Boolean(icon), (el) => el.child(icon))
      .child(div().min_w(0).flex_1().truncate().text_size(11.5).text_color(t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(mark(t, status));
  }

  // Closing an agent must not take its space with it: Herdr ends a space when
  // its last tab closes, so a shell tab stands in first when it would.
  closeAgent(space, a) {
    const term = this.terminals.find((x) => x.address === a.address);
    if (!term) return;
    if (term.parent) {
      // A kept sub-agent shares its parent's tab: only its own pane goes.
      const pane = a.pane ?? panes().find((p) => p.terminal === a.address)?.pane;
      if (!pane) return;
      if (panes().filter((p) => p.tab === a.tab).length <= 1) this.standIn(space);
      run("pane.close", { pane });
      return;
    }
    const tabs = space.tabs ?? [];
    if (!tabs.some((x) => x.id === a.tab)) return;
    if (tabs.length <= 1) this.standIn(space);
    run("tab.close", { id: a.tab, confirmed: true });
  }

  // A plain shell in the space, so closing the last agent of a space does not
  // close the space with it. The space and its pin stay.
  standIn(space) {
    run("tab.new", { space: space.id, folder: space.folder, focus: false });
  }

  row({ w, i, g, tree }, t) {
    const on = w.active;
    const fromIndex = this.pressed === null ? -1 : spaces().findIndex(s => s.id === this.pressed);
    const look = spaceLook(t, w.id);
    const fill = look.color;
    const icon = look.icon;
    // The row wears the space's own colour, a shade deeper so the white
    // letters, icons and marks read on it; the active one and the one under
    // the pointer wear it a shade brighter.
    const ground = deepen(fill, 0.34);
    const worn = on ? lighten(ground, 0.1) : ground;
    const hover = lighten(ground, 0.2);
    // Its face: the icon it was given, else its first letter. Both sit on a
    // square chip, so they stand off the row's colour.
    const badge = icon
      ? h_flex()
          .size(18)
          .flex_none()
          .items_center()
          .justify_center()
          .bg("#00000045")
          .child(lookIcon(icon, 13, "#ffffff"))
      : h_flex()
          .size(18)
          .flex_none()
          .bg("#ffffff30")
          .items_center()
          .justify_center()
          .text_size(10.5)
          .font_bold()
          .text_color("#ffffff")
          .child([...w.name][0]?.toUpperCase() ?? "?");
    const spaceRow = v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .bg(worn)
      .when(!on, (el) => el.hover((s) => s.bg(hover)))
      .when(this.pressed === w.id && this.over !== w.id, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === w.id && this.pressed !== w.id, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(fromIndex < i, line => line.bottom(0))
          .when(fromIndex > i, line => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.pressed = w.id;
        this.over = w.id;
      })
      .on_mouse_move((_e, cx) => {
        const source = spaces().find(s => s.id === this.pressed);
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? w.id : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from !== null && over === w.id && from !== w.id) {
          const index = spaces().findIndex(s => s.id === w.id);
          if (index !== -1) run("space.move", { id: from, index: index + 1 });
        } else if (from === w.id) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .on_hover((on, cx) => {
        if (on) this.hovered = w.id;
        else if (this.hovered === w.id) this.hovered = null;
        cx.notify();
      })
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), el => el.pl(22).child(svg("mods/workspace-chrome/branch.svg").size(13).flex_none().text_color("#ffffffe0")))
          .when(!tree, el => el.child(badge))
          .child(div().flex_initial().min_w(SIDE_MIN).truncate().text_color("#ffffff").child(w.name))
          .child(g ? this.gitTail(g, tree, w.name, t, true) : div().flex_1())
          .when(isPinned(w.id), (el) => el.child(
            h_flex()
              .id(`space-pin-${w.id}`)
              .w(18)
              .flex_none()
              .justify_center()
              .items_center()
              .cursor_pointer()
              .tooltip("Pinned: it stays until you unpin it")
              .on_click((_e, cx) => {
                cx.stop_propagation();
                togglePin(w.id);
                cx.notify();
              })
              .child(svg("mods/workspace-chrome/pin.svg").size(11).flex_none().text_color("#ffffffe0")),
          ))
          .when(this.hovered === w.id, (el) => el.child(
            h_flex()
              .flex_none()
              .gap(1)
              .items_center()
              .child(this.action(`space-claude-${w.id}`, "mods/workspace-chrome/terminal.svg", "Claude in this space, without asking", () => run("tab.new", { name: "Claude", space: w.id, argv: ["claude", "--dangerously-skip-permissions"] }), true))
              .child(this.action(`space-look-${w.id}`, "mods/herdr-dock/palette.svg", "Its icon and colour", () => openOverlay({ mod: "herdr-look", kind: "dialog", width: 430, height: 600, props: { space: w.id } }), true))
              .child(this.action(`space-notes-${w.id}`, "mods/workspace-chrome/file-text.svg", "Notes for this space", () => openOverlay({ mod: "herdr-notes", kind: "dialog", width: 480, height: 580, props: { space: w.id } }), true)),
          )),
      );
    // The agents of this space live under it: a child row each, so the tree
    // reads space -> agent -> work, and an agent can be closed from where it
    // works.
    const here = this.agentsOf(w.id, this.terminals);
    if (!here.length) return spaceRow;
    const rows = [];
    here.forEach((a, n) => {
      rows.push(this.agentRow(t, w, a, n === here.length - 1));
      for (const s of this.subTree(this.terminals, a.address)) rows.push(this.subAgentRow(t, s));
    });
    return v_flex().id(`space-group-${w.id}`).flex_none().child(spaceRow).children(rows);
  }

  compact({ w, i }, t) {
    const look = spaceLook(t, w.id);
    const ground = deepen(look.color, 0.34);
    const worn = w.active ? lighten(ground, 0.1) : ground;
    return railCell(h_flex()
      .id(`space-${w.id}`)
      .relative()
      .w(RAIL_CELL)
      .h(26)
      .justify_center()
      .items_center()
      .bg(worn)
      .when(!w.active, (el) => el.hover((s) => s.bg(lighten(ground, 0.2))))
      .on_click(() => run("space.select", { id: w.id }))
      .child(look.icon ? lookIcon(look.icon, 13, "#ffffff") : div().text_color("#ffffff").child(String(i + 1)))
      .when(isPinned(w.id), (el) => el.child(div().absolute().right(3).top(2).child(svg("mods/workspace-chrome/pin.svg").size(8).flex_none().text_color("#ffffff"))))
      .child(div().absolute().right(5).text_color(tone(t, w.status)).child(glyph(w.status))));
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    // What the agent rows under the spaces are drawn from.
    this.terminals = terminals();
    this.tabs = new Map(sp.flatMap((s) => s.tabs ?? []).map((tab) => [tab.id, tab]));
    this.listed = new Set(agents().map((a) => a.address));
    const list = this.grouped(t, collapsed);
    // Bring the active space into view when it, or its place in the list, changes; a row already in view stays put.
    const active = sp.find(p => p.active)?.id;
    if (active !== this.revealed || this.activeAt !== this.revealedAt) {
      this.revealed = active;
      this.revealedAt = this.activeAt;
      if (this.activeAt >= 0) this.scroll.scroll_to_item(this.activeAt);
    }
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(collapsed, el => el.pl(0).pr(0).justify_center())
        .when(!collapsed, el => el.child("Spaces"))
        .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("space.new")).child(svg("mods/workspace-chrome/plus.svg").size(14))))
      .child(v_flex().flex_1().min_h(0).px(collapsed ? 0 : 8).pb(14).overflow_y_scrollbar().mode("always").track_scroll(this.scroll)
        // A block above (another mod's) growing, or the window resizing, shrinks this list and can push the active space out.
        .on_size_change((_size, cx) => { if (this.activeAt >= 0) { this.scroll.scroll_to_item(this.activeAt); cx.notify(); } })
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .children(list));
  }
}
