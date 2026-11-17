// The panels the sidebar bar opens: the theme list and what the plan has left.
// It opens as a popup with props { panel: "theme" | "usage" }.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, themes, run, shared, setShared, props, closeOverlay, exec, checking } from "herdr";

const PICKS = [
  { name: "atom-one-dark", label: "Default", dot: "#61afef" },
  { name: "tron-blue", label: "Tron blue", dot: "#4dd2ff" },
  { name: "tron-orange", label: "Tron orange", dot: "#ff9f1c" },
];

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

// The windows we have seen, newest first. A window's beginning is when the
// credits came back, so this is how they come back, over the days.
const RESETS = "herdr.usageResets";

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

// How long is left, in words.
function span(ms) {
  if (!ms) return "";
  const s = Math.max(0, Math.round((ms - Date.now()) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  return h ? `${h}h ${m}m` : `${m}m`;
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

// The windows we have seen, newest first.
function windows() {
  const list = shared(RESETS);
  return Array.isArray(list) ? list : [];
}

export default class Panel extends View {
  init(_props, cx) {
    this.usage = shared("herdr.usage") ?? null;
    if (checking()) return;
    if (props()?.panel === "usage") cx.spawn(async (cx) => this.refresh(cx));
  }

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
    cx.notify();
  }

  pick(p, named, t) {
    const on = named === p.name;
    return h_flex()
      .id(`theme-${p.name}`)
      .h(26)
      .px(8)
      .gap(7)
      .rounded(6)
      .items_center()
      .cursor_pointer()
      .when(on, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        run("app.theme", { name: p.name });
        setShared("herdr.theme", p.name);
        closeOverlay(props()?.overlay);
        cx.notify();
      })
      .child(div().size(10).flex_none().rounded_full().bg(p.dot))
      .child(div().flex_1().text_size(11.5).text_color(on ? t.foreground : t.muted).child(p.label))
      .when(on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(12).flex_none().text_color(t.accent)));
  }

  // One bar of the plan: how much of it is used, when the window it sits in
  // ends, and when that window began. A window that has ended gives the
  // whole quota back, and the next one starts with the next use.
  meter(label, win, word, t) {
    const end = win?.end ?? null;
    const start = win?.start ?? null;
    const over = end != null && end <= Date.now();
    const used = over ? 0 : usedOf(win?.pct);
    if (used == null) {
      return h_flex()
        .items_center()
        .gap(6)
        .child(div().flex_1().min_w(0).text_size(10.5).text_color(t.dim).child(label))
        .child(div().flex_none().text_size(10.5).text_color(t.dim).child("—"));
    }
    // The bar is a gradient from green to red: the more of the plan is used,
    // the further along the red it shows.
    const pieces = [];
    const steps = 120;
    for (let i = 0; i < steps; i++) {
      const k = (i + 0.5) / steps;
      pieces.push(div().flex_1().h_full().bg(k <= used / 100 ? ramp(t, k) : t.raised));
    }
    return v_flex()
      .id(`meter-${label}`)
      .gap(3)
      .child(
        h_flex()
          .items_center()
          .gap(6)
          .child(div().flex_1().min_w(0).text_size(10.5).text_color(t.dim).child(label))
          .child(div().flex_none().text_size(10.5).text_color(t.foreground).child(`${used}% used`)),
      )
      .child(h_flex().w_full().h(6).rounded(3).bg(t.raised).overflow_hidden().children(pieces))
      .when(end, (el) => el.child(div().text_size(10).text_color(t.dim).child(over ? `quota back at ${clock(end)} · waits for your next use` : `resets ${clock(end)} · ${span(end)} left`)))
      .when(start, (el) => el.child(div().text_size(10).text_color(t.dim).child(`${word} ${clock(start)} → ${clock(end)}`)));
  }

  themePanel(t) {
    const named = inUse(t, themes()) ?? shared("herdr.theme") ?? null;
    return v_flex()
      .id("herdr-theme-panel")
      .w_full()
      .p(6)
      .gap(3)
      .bg(t.popover)
      .child(div().px(8).pt(3).pb(5).text_size(11).text_color(t.dim).child("Theme"))
      .children(PICKS.map((p) => this.pick(p, named, t)));
  }

  usagePanel(t) {
    const usage = this.usage ?? shared("herdr.usage") ?? null;
    let body;
    if (!usage) {
      body = v_flex().gap(4).child(div().text_size(11.5).text_color(t.muted).child("MiniMax M")).child(div().text_size(10.5).text_color(t.dim).child("Reading the plan…"));
    } else if (!usage.ok) {
      body = v_flex()
        .gap(4)
        .child(div().text_size(11.5).text_color(t.muted).child("MiniMax M"))
        .child(div().text_size(10.5).text_color(t.dim).child(usage.error));
    } else {
      // The windows we have seen, newest first: when each one began, which is
      // when the credits came back.
      const backs = windows().map((w) => clock(w.start)).filter((s) => s !== "—").slice(0, 4);
      body = v_flex()
        .gap(5)
        .child(h_flex().items_center().justify_between().child(div().text_size(11.5).text_color(t.muted).child("MiniMax M")).child(div().text_size(10).text_color(t.dim).child(usage.model ?? "")))
        .child(div().text_size(10).text_color(t.dim).child("How much of the plan is used."))
        .child(this.meter("5h window", usage.interval, "window", t))
        .when(usage.weekly, (el) => el.child(this.meter("this week", usage.weekly, "week", t)))
        .when(backs.length, (el) =>
          el.child(
            h_flex()
              .items_center()
              .gap(6)
              .child(div().flex_none().text_size(10).text_color(t.dim).child("credits back"))
              .child(div().flex_1().min_w(0).text_size(10).text_color(t.dim).child(backs.join(" · "))),
          ),
        );
    }
    return v_flex()
      .id("herdr-usage-panel")
      .w_full()
      .p(8)
      .gap(6)
      .bg(t.popover)
      .child(body);
  }

  render(cx) {
    const t = theme();
    return props()?.panel === "usage" ? this.usagePanel(t) : this.themePanel(t);
  }
}
