// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "herdr-pane" } } } }
// Shows the program's icon (the app's program table), the agent's name or
// the terminal's title, the folder, and the agent's status; buttons split, zoom and close
// this pane. Props from the app: { pane, terminal }. Click: focus the pane.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home, layout, spaces, shared } from "herdr";
import * as fs from "fs/promises";

// Match the first visible tab frame, including the active child of a stack.
function paneFrame(node) {
  if (!node || node.hidden) return null;
  if (node.content?.tab && node.content.pane) return node.content.pane;
  let children = node.children ?? [];
  if (node.type === "stack") {
    const visible = children.filter(child => !child.hidden);
    children = [visible.find(child => child.id === node.active) ?? visible[0]];
  }
  for (const child of children) {
    const frame = paneFrame(child);
    if (frame) return frame;
  }
  return null;
}

// What a stored color name looks like on a space (the same in every mod that
// draws space colours): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// A color with black mixed into it: the ground the white letters stand on.
function deepen(c, amount) {
  if (!/^#[0-9a-f]{6}$/i.test(c)) return c;
  const n = parseInt(c.slice(1), 16);
  const mix = (v) => Math.round(v * (1 - amount));
  const out = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => mix(v).toString(16).padStart(2, "0"));
  return `#${out.join("")}`;
}

// The color of a space, as the spaces list set it.
function spaceColor(t, id) {
  if (!id) return null;
  const c = (shared("space.colors") ?? {})[id] ?? "ansi6";
  return c.startsWith("#") ? c : (MARK[c] ?? t[c] ?? t.dim);
}

// The space a pane lives in: the tab it shows belongs to one.
function spaceOf(p) {
  const all = spaces();
  for (const s of all) if ((s.tabs ?? []).some((tab) => tab.id === p.tab)) return s;
  return all.find((s) => s.active) ?? null;
}

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

// The frame around the chat window wears the space's colour. The frame is the
// layout's own, so the layout file is rewritten with the new colour; the app
// reads it back and paints it.
async function paintFrame(color) {
  const name = shared("layout") ?? "herdr";
  const path = `${home()}/.config/herdr-app/layouts/${name}.json`;
  // The file belongs to the user as much as to us: they edit it by hand, and
  // they drag the sizes around in it. So read it again before writing, and if
  // it moved under us, paint the newer copy rather than the one we read —
  // otherwise an edit made in the last moment is written over by the colour we
  // were about to set. A file mid-edit does not parse: leave it alone and try
  // again on the next tick rather than throwing.
  for (let attempt = 0; attempt < 3; attempt++) {
    let raw;
    let tree;
    try {
      raw = await fs.readFile(path, "utf8");
      tree = JSON.parse(raw);
    } catch {
      return false;
    }
    if (!paint(tree, color)) return false;
    try {
      if (await fs.readFile(path, "utf8") !== raw) continue;
    } catch {
      return false;
    }
    await fs.writeFile(path, `${JSON.stringify(tree, null, 2)}\n`);
    return true;
  }
  return false;
}

// The colour on every pane frame in the tree. True if anything changed.
function paint(tree, color) {
  let changed = false;
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const pane = node.content?.pane;
    if (pane && typeof pane === "object") {
      if (pane.focus?.color !== color || pane.radius !== 0) {
        pane.focus = { width: 1, color };
        pane.radius = 0;
        changed = true;
      }
    }
    Object.values(node).forEach(walk);
  };
  walk(tree);
  return changed;
}

export default class Pane extends View {
  init(_props, cx) {
    this.hovered = false;
    this.color = null;
    this.writing = null;
    // The frame follows the space in front: check now, and now and then.
    cx.timer.every(2000, (cx) => this.checkFrame(cx));
  }

  // The colour the frame should wear: the space in front.
  want(t) {
    const space = spaces().find((s) => s.active);
    return spaceColor(t, space?.id);
  }

  // Paint the frame, if the layout does not say that colour already.
  checkFrame(cx) {
    const t = theme();
    const color = this.want(t);
    if (!color) return;
    this.color = color;
    if (this.writing === color) return;
    this.writing = color;
    cx.spawn(async (cx) => {
      try {
        if (await paintFrame(color)) cx.notify();
      } catch (e) {
        console.log("frame:", String(e?.message ?? e));
      }
      this.writing = null;
      cx.notify();
    });
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, icon, command, args, on = false) {
    return div()
      .id(id)
      .p(3)
      .text_color(on ? "#ffffffc0" : t.dim)
      .hover((s) => s.bg(on ? "#ffffff33" : t.hover).text_color(on ? "#ffffff" : t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/herdr-pane/${icon}.svg`).size(14));
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    // The header wears the color of the space the pane lives in, deep enough
    // for the white letters to read on it.
    const tint = spaceColor(t, spaceOf(p)?.id);
    const ground = tint ? deepen(tint, 0.4) : t.background;
    const on = Boolean(tint);
    if (tint !== this.color) this.checkFrame(cx);
    const pic = icon(p.program, 14, on ? "#ffffffc0" : t.dim);
    const st = p.status;
    const pane = p.pane;
    const bottom = paneFrame(layout())?.header?.position === "bottom";
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(ground)
      .when(bottom, el => el.border_t(1))
      .when(!bottom, el => el.border_b(1))
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_medium().text_color(on ? "#ffffff" : t.foreground).child(name))
      .child(div().flex_1().truncate().text_color(on ? "#ffffffb8" : t.dim).child(folder(p.cwd)))
      .when(st === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(on ? "#ffffff" : t.working).spin(900)))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().bg(on ? "#00000045" : t.blocked + "26").text_size(10.5).font_semibold().text_color(on ? "#ffffff" : t.blocked).child("Needs you")))
      .when(st === "done", el => el.child(div().size(7).flex_none().bg(on ? "#ffffff" : t.done)))
      .when(this.hovered, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }, on))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }, on))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }, on))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane }, on)));
  }
}
