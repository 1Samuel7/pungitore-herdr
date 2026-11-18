// A bar in the sidebar, above Settings: the theme, what the plan has left,
// and what the Learning Loop has waiting. It sits out of the way; every
// button opens its own panel beside it.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, themes, run, shared, setShared, spaces, exec, openOverlay, checking, nextCommand, notify, layout, home } from "herdr";

// The spaces that must not be closed by accident.
const PINNED = "herdr.pinned";

// The windows we have seen, newest first. A window's beginning is when the
// credits came back, so this is how they come back, over the days.
const RESETS = "herdr.usageResets";

const PICKS = [
  { name: "atom-one-dark", label: "Default", dot: "#61afef" },
  { name: "tron-blue", label: "Tron blue", dot: "#4dd2ff" },
  { name: "tron-orange", label: "Tron orange", dot: "#ff9f1c" },
];

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

// The theme in use is the one whose colours are the ones in front of us.
function inUse(t, all) {
  const keys = ["background", "foreground", "muted", "accent", "selection", "border", "canvas", "surface", "raised", "input"];
  let best = null;
  let score = 0;
  for (const th of all) {
    const c = th.colors ?? {};
    let hit = 0;
    let seen = 0;
    for (const k of keys) {
      if (!c[k] || !t[k]) continue;
      seen++;
      if (c[k] === t[k]) hit++;
    }
    const s = seen ? hit / seen : 0;
    if (s > score) {
      score = s;
      best = th.name;
    }
  }
  return score >= 0.95 ? best : null;
}

// The bar's colour: green while there is room to spare, red when the plan is
// nearly used up.
const GREEN = "#3fae6a";
const AMBER = "#d7b23a";
const RED = "#e2564a";

// The days of the week, for saying when a window ends.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function mix(a, b, k) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sh) => Math.round(((pa >> sh) & 255) + (((pb >> sh) & 255) - ((pa >> sh) & 255)) * k);
  return `#${[ch(16), ch(8), ch(0)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// How much of the plan is used, in percent. The plan says what is left.
function usedOf(left) {
  if (left == null) return null;
  return Math.max(0, Math.min(100, 100 - left));
}

// The colour the bar has at that point of its way from green to red. The
// three are the bar's own, not the theme's: the bar always says green, amber,
// red, whatever the window wears.
function ramp(t, k) {
  return k <= 0.5 ? mix(GREEN, AMBER, k / 0.5) : mix(AMBER, RED, (k - 0.5) / 0.5);
}

// What the plan says is left of it. The key stays in mmx's own config.
async function plan() {
  const r = await exec("mmx", ["quota", "show", "--output", "json"], { timeout: 20000 });
  if (r.code !== 0) throw new Error((r.stderr || "").trim() || `mmx exited ${r.code}`);
  const q = JSON.parse(r.stdout);
  const all = q.model_remains ?? [];
  const m = all.find((x) => /m3|flash|general/i.test(x.model_name ?? "")) ?? all[0];
  if (!m) throw new Error("the plan said nothing about the model");
  return m;
}

// A time, the way a person would say it: "14:20" today, "Tue 00:12" when it
// falls on another day.
function clock(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const now = new Date();
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (days === 0) return hm;
  if (Math.abs(days) === 1) return `${DAYS[d.getDay()]} ${hm}`;
  return `${DAYS[d.getDay()]} ${d.getDate()} ${hm}`;
}

// Keep the windows we have seen: the first time we meet one, it goes in.
function remember(start, end) {
  if (!end) return;
  const seen = shared(RESETS);
  const list = Array.isArray(seen) ? seen : [];
  if (list.some((r) => r.end === end)) return;
  setShared(RESETS, [{ start: start ?? null, end, at: Date.now() }, ...list].slice(0, 24));
}

// How many candidate lessons the Learning Loop has waiting for a decision.
// It publishes the count in a marker comment, so it is read as a fact rather
// than by parsing another plugin's files: the marker is the contract, the
// directory it lives in is an accident of layout (ADR-0013).
async function pendingLessons() {
  const dir = `${home()}/.claude/plugins/data`;
  try {
    const result = await exec(
      "grep",
      ["-rhoE", "--include=*.md", "<!-- pungitore-learning: pending [0-9]+ -->", dir],
      { timeout: 5000 },
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

export default class Dock extends View {
  init(_props, cx) {
    this.usage = shared("herdr.usage") ?? null;
    this.lessons = 0;
    if (checking()) return;
    cx.spawn(async (cx) => this.refresh(cx));
    cx.timer.every(60000, (cx) => this.refresh(cx));
    // Keys reach this mod by its name: herdr-dock.theme, herdr-dock.lessons.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "theme") this.cycle(cx);
        else if (c === "lessons") this.lessonsPanel(cx);
        else if (c === "pin") this.pin(cx);
        else if (c === "pinall") this.pinAll(cx);
        else if (c === "unpinall") this.unpinAll(cx);
        cx.notify();
      }
    });
  }

  // The next theme in the list, and back round to the first.
  cycle(cx) {
    const t = theme();
    const named = inUse(t, themes()) ?? shared("herdr.theme") ?? null;
    const at = PICKS.findIndex((p) => p.name === named);
    const next = PICKS[(at + 1) % PICKS.length];
    run("app.theme", { name: next.name });
    setShared("herdr.theme", next.name);
    cx.notify();
  }

  // The candidates waiting for a decision, in a panel of their own.
  lessonsPanel(cx) {
    openOverlay({ mod: "herdr-panel", kind: "popup", width: 420, height: 460, props: { panel: "lessons" } });
    cx.notify();
  }

  // Pin the space in front, so it cannot be closed by accident.
  pin(cx) {
    const space = spaces().find((s) => s.active);
    if (!space) return;
    const list = shared(PINNED) ?? [];
    const on = list.includes(space.id);
    setShared(PINNED, on ? list.filter((x) => x !== space.id) : [...list, space.id]);
    notify({ title: on ? "Unpinned" : "Pinned", body: space.name, level: "info" });
    cx.notify();
  }

  // Pin them all, so none of them goes by accident.
  pinAll(cx) {
    setShared(PINNED, spaces().map((s) => s.id));
    setShared("herdr.pinNew", true);
    notify({ title: "Every space is pinned", body: "Unpin any of them from its menu.", level: "info" });
    cx.notify();
  }

  // Let them go again.
  unpinAll(cx) {
    setShared(PINNED, []);
    setShared("herdr.pinNew", false);
    notify({ title: "No space is pinned", level: "info" });
    cx.notify();
  }

  // The plan and the candidates: both are read on a timer, and both are
  // facts about this machine rather than about the space in front.
  async refresh(cx) {
    let next;
    try {
      const m = await plan();
      const interval = { pct: m.current_interval_remaining_percent ?? null, start: m.start_time ?? null, end: m.end_time ?? null };
      // The window's edges are when the credits came back and go out again.
      remember(interval.start, interval.end);
      next = {
        at: Date.now(),
        ok: true,
        model: m.model_name ?? null,
        interval,
        // 3: no weekly limit on this plan.
        weekly: m.current_weekly_status === 3 ? null : { pct: m.current_weekly_remaining_percent ?? null, start: m.weekly_start_time ?? null, end: m.weekly_end_time ?? null },
      };
    } catch (e) {
      next = { at: Date.now(), ok: false, error: String(e?.message ?? e) };
    }
    setShared("herdr.usage", next);
    this.usage = next;
    this.lessons = await pendingLessons();
    cx.notify();
  }

  // A small button in the bar.
  btn(id, icon, tip, onClick, color) {
    const t = theme();
    return h_flex()
      .id(id)
      .size(26)
      .flex_none()
      .items_center()
      .justify_center()
      .rounded(6)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip(tip)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        onClick(cx);
      })
      .child(svg(`mods/herdr-dock/${icon}.svg`).size(14).flex_none().text_color(color ?? t.dim));
  }

  // What the plan has left, in one line: a bar, the number, and the time the
  // window it sits in ends.
  usageMini(t, usage) {
    const open = () => openOverlay({ mod: "herdr-panel", kind: "popup", width: 320, height: 220, props: { panel: "usage" } });
    const wrap = (content, tip) =>
      h_flex()
        .id("dock-usage")
        .flex_1()
        .min_w(0)
        .h(26)
        .px(4)
        .gap(6)
        .items_center()
        .rounded(6)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .tooltip(tip)
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open();
        })
        .child(content);
    if (!usage) return wrap(div().text_size(10.5).text_color(t.dim).child("Reading the plan…"), "MiniMax M");
    if (!usage.ok) return wrap(div().text_size(10.5).text_color(t.dim).child("No plan"), usage.error);
    // The bar fills with what is used of the plan, and turns red as it goes.
    const start = usage.interval?.start ?? null;
    const end = usage.interval?.end ?? null;
    // The window has ended: the plan gives the whole quota back, and the next
    // window starts with the next use.
    const over = end != null && end <= Date.now();
    const used = over ? 0 : usedOf(usage.interval?.pct);
    // The rail is too thin for the words; the clock goes with them.
    const room = !narrow();
    const tip = over
      ? `MiniMax M: the 5-hour quota is whole — it came back at ${clock(end)}`
      : used == null
        ? "MiniMax M"
        : [`MiniMax M: ${used}% of the 5-hour window used`, start ? `credits back ${clock(start)}` : null, end ? `resets ${clock(end)}` : null].filter(Boolean).join(" · ");
    return wrap(
      h_flex()
        .flex_1()
        .min_w(0)
        .gap(6)
        .items_center()
        .when(room, (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child("MiniMax")))
        .child(this.gradient(t, used, 5, 36))
        .child(div().w(28).flex_none().text_size(10.5).text_color(t.foreground).child(over ? "full" : used == null ? "—" : `${used}%`))
        .when(
          room && end,
          (el) =>
            el.child(
              h_flex()
                .flex_none()
                .items_center()
                .gap(4)
                .child(svg("mods/herdr-dock/clock.svg").size(11).flex_none().text_color(t.dim))
                .child(div().text_size(10.5).text_color(t.dim).child(clock(end))),
            ),
        ),
      tip,
    );
  }

  // The bar: a gradient from green to red, showing how much of the plan is
  // used. Boxes take no gradient, so the bar is a row of small pieces, each
  // the colour the ramp has at that point.
  gradient(t, used, height, steps) {
    const track = h_flex().flex_1().min_w(0).h(height).rounded(3).bg(t.raised).overflow_hidden();
    if (used == null) return track;
    const pieces = [];
    for (let i = 0; i < steps; i++) {
      const k = (i + 0.5) / steps;
      pieces.push(div().flex_1().h_full().bg(k <= used / 100 ? ramp(t, k) : t.raised));
    }
    return track.children(pieces);
  }

  render(cx) {
    const t = theme();
    const usage = this.usage ?? shared("herdr.usage") ?? null;
    const lessons = this.lessons ?? 0;
    // What the Learning Loop is waiting for: a global fact, so it sits here
    // with the plan, not in the to-do panel, which is about one space.
    const lessonsRow = lessons > 0
      ? h_flex()
          .id("dock-lessons")
          .w_full()
          .h(24)
          .px(6)
          .gap(6)
          .items_center()
          .rounded(6)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .tooltip("Candidate lessons waiting to be promoted into your rules")
          .on_click((_e, cx) => {
            cx.stop_propagation();
            this.lessonsPanel(cx);
          })
          .child(svg("mods/workspace-chrome/layers.svg").size(13).flex_none().text_color(t.muted))
          .child(
            div()
              .flex_1()
              .min_w(0)
              .truncate()
              .text_size(10.5)
              .text_color(t.muted)
              .child(`${lessons} lesson${lessons === 1 ? "" : "s"} to review`),
          )
      : null;
    return v_flex()
      .id("herdr-dock")
      .size_full()
      .px(8)
      .gap(4)
      .items_center()
      .border_t(1)
      .border_color(t.border)
      .when(lessonsRow, (el) => el.child(lessonsRow))
      .child(
        h_flex()
          .w_full()
          .gap(6)
          .items_center()
          .child(this.btn("dock-theme", "palette", "Themes", () => openOverlay({ mod: "herdr-panel", kind: "popup", width: 250, height: 170, props: { panel: "theme" } }), t.muted))
          .child(this.usageMini(t, usage)),
      );
  }
}
