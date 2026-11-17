// A space's own look: the icon or emoji that stands for it, and the colour
// its row wears. Opened as a dialog with props { space }. Both live in shared
// state, so the spaces list and the agents list draw it the same way.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, theme, spaces, shared, setShared, closeOverlay, checking } from "herdr";

const ICON_KEY = "herdr.spaceIcons";
const COLOR_KEY = "space.colors";

const EMOJI = [
  "🚀", "🎯", "🧪", "🐙", "🌊", "⚡",
  "🧩", "📚", "🔧", "🎨", "🛰️", "🧠",
  "🌱", "🗺️", "📦", "🧵", "🐢", "🔥",
  "🌙", "☕", "🍿", "🐝", "🎧", "🪄",
];

const GLYPHS = [
  "file-text", "terminal", "git-branch", "server", "monitor", "folder", "files",
  "search", "layers", "archive", "clock", "settings", "square",
];

const COLORS = [
  "#e2564a", "#e08a3c", "#d7b23a", "#8fbf3f", "#3fae6a", "#22a99a", "#3aa8d8",
  "#5b8def", "#8b7cf6", "#c060d8", "#d9649a", "#b0895c", "#9aa0a6", "#e9edf2",
];

// The colour a row wears: the one chosen, a shade deeper so the white
// letters read on it.
const MARK = { ansi6: "#22a99a" };

function deepen(c, amount) {
  if (!/^#[0-9a-f]{6}$/i.test(c)) return c;
  const n = parseInt(c.slice(1), 16);
  const mix = (v) => Math.round(v * (1 - amount));
  const out = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => mix(v).toString(16).padStart(2, "0"));
  return `#${out.join("")}`;
}

const rows = (items, per) => {
  const out = [];
  for (let i = 0; i < items.length; i += per) out.push(items.slice(i, i + per));
  return out;
};

export default class Look extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.draft = InputState.new({ placeholder: "Any emoji or letter…" });
    this.draft.on("submit", (_e, cx) => this.useDraft(cx));
  }

  spaceId() {
    const p = props() ?? {};
    return p.space ?? spaces().find((s) => s.active)?.id ?? null;
  }

  iconOf() {
    const id = this.spaceId();
    return (shared(ICON_KEY) ?? {})[id] ?? "";
  }

  colorOf() {
    const id = this.spaceId();
    return (shared(COLOR_KEY) ?? {})[id] ?? "";
  }

  // The icon for the space: an emoji, or one of Herdr's own glyphs.
  setIcon(value, cx) {
    const id = this.spaceId();
    if (!id) return;
    const all = { ...(shared(ICON_KEY) ?? {}) };
    if (value) all[id] = value;
    else delete all[id];
    setShared(ICON_KEY, all);
    cx.notify();
  }

  // The colour for the space: a hex, or Herdr's own choice when it is empty.
  setColor(value, cx) {
    const id = this.spaceId();
    if (!id) return;
    const all = { ...(shared(COLOR_KEY) ?? {}) };
    if (value) all[id] = value;
    else delete all[id];
    setShared(COLOR_KEY, all);
    cx.notify();
  }

  useDraft(cx) {
    const text = [...this.draft.value().trim()][0] ?? "";
    if (!text) return;
    this.setIcon(text, cx);
    this.draft.set_value("");
    cx.notify();
  }

  emojiButton(e, t) {
    const on = this.iconOf() === e;
    return h_flex()
      .id(`emoji-${e.codePointAt(0)}`)
      .size(30)
      .flex_none()
      .items_center()
      .justify_center()
      .rounded(7)
      .cursor_pointer()
      .bg(on ? t.selected : t.raised)
      .border_1()
      .border_color(on ? t.accent : t.border)
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.setIcon(e, cx);
      })
      .child(div().text_size(15).child(e));
  }

  glyphButton(name, t) {
    const on = this.iconOf() === `svg:${name}`;
    return h_flex()
      .id(`glyph-${name}`)
      .size(30)
      .flex_none()
      .items_center()
      .justify_center()
      .rounded(7)
      .cursor_pointer()
      .bg(on ? t.selected : t.raised)
      .border_1()
      .border_color(on ? t.accent : t.border)
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.setIcon(`svg:${name}`, cx);
      })
      .child(svg(`mods/workspace-chrome/${name}.svg`).size(14).flex_none().text_color(on ? t.foreground : t.muted));
  }

  swatch(c, t) {
    const on = this.colorOf() === c;
    return h_flex()
      .id(`swatch-${c.slice(1)}`)
      .size(26)
      .flex_none()
      .items_center()
      .justify_center()
      .rounded(7)
      .cursor_pointer()
      .border_2()
      .border_color(on ? t.accent : t.border)
      .hover((s) => s.opacity(0.85))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.setColor(c, cx);
      })
      .child(div().size(16).rounded(4).bg(c));
  }

  // The row as the sidebar draws it: the colour, deeper, with the icon and
  // the name in white on it.
  preview(t, space, color, icon) {
    const base = color && color.startsWith("#") ? color : MARK.ansi6;
    const ground = deepen(base, 0.34);
    const face = icon
      ? h_flex()
          .size(18)
          .flex_none()
          .items_center()
          .justify_center()
          .bg("#00000045")
          .child(icon.startsWith("svg:") ? svg(`mods/workspace-chrome/${icon.slice(4)}.svg`).size(13).flex_none().text_color("#ffffff") : div().text_size(13).child(icon))
      : h_flex()
          .size(18)
          .flex_none()
          .bg("#ffffff30")
          .items_center()
          .justify_center()
          .text_size(10.5)
          .font_bold()
          .text_color("#ffffff")
          .child([...(space?.name ?? "S")][0]?.toUpperCase() ?? "?");
    return h_flex()
      .id("look-preview")
      .h(30)
      .px(8)
      .gap(9)
      .items_center()
      .bg(ground)
      .child(face)
      .child(div().flex_1().truncate().text_color("#ffffff").child(space?.name ?? "This space"))
      .child(div().flex_none().text_size(11.5).text_color("#ffffffb8").child("main"));
  }

  render(cx) {
    const t = theme();
    const id = this.spaceId();
    const space = spaces().find((s) => s.id === id);
    const icon = this.iconOf();
    const color = this.colorOf();
    const grid = (items, per, cell) =>
      v_flex()
        .gap(5)
        .children(rows(items, per).map((r) => h_flex().gap(5).children(r.map(cell))));
    return v_flex()
      .id("herdr-look")
      .track_focus(this.handle)
      .size_full()
      .min_h(0)
      .p(16)
      .gap(12)
      .rounded(8)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        closeOverlay(props().overlay);
        cx.stop_propagation();
      })
      .child(
        h_flex()
          .items_center()
          .gap(8)
          .child(div().text_size(15).font_semibold().text_color(t.foreground).child(space ? `Look of ${space.name}` : "Look"))
          .child(div().flex_1())
          .child(div().text_size(11).text_color(t.dim).child("Esc to close")),
      )
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .gap(14)
          .child(
            v_flex()
              .gap(7)
              .child(h_flex().items_center().gap(8).child(div().text_size(12.5).font_semibold().text_color(t.foreground).child("Icon")).child(div().flex_1()))
              .child(grid(EMOJI, 6, (e) => this.emojiButton(e, t)))
              .child(grid(GLYPHS, 7, (g) => this.glyphButton(g, t)))
              .child(h_flex().gap(6).items_center()
                .child(Input.new(this.draft).flex_1().h(30).px(9).rounded(8).border_1().border_color(t.input).bg(t.background))
                .child(
                  h_flex()
                    .id("look-icon-none")
                    .h(30)
                    .px(10)
                    .flex_none()
                    .items_center()
                    .rounded(8)
                    .cursor_pointer()
                    .bg(icon ? t.raised : t.selected)
                    .text_color(t.foreground)
                    .hover((s) => s.bg(t.hover))
                    .on_click((_e, cx) => {
                      cx.stop_propagation();
                      this.setIcon("", cx);
                    })
                    .child("No icon"),
                )),
          )
          .child(
            v_flex()
              .gap(7)
              .child(h_flex().items_center().gap(8).child(div().text_size(12.5).font_semibold().text_color(t.foreground).child("Colour")).child(div().flex_1()))
              .child(grid(COLORS, 7, (c) => this.swatch(c, t)))
              .child(h_flex().gap(6).items_center()
                .child(
                  h_flex()
                    .id("look-color-auto")
                    .h(30)
                    .px(10)
                    .items_center()
                    .rounded(8)
                    .cursor_pointer()
                    .bg(color ? t.raised : t.selected)
                    .text_color(t.foreground)
                    .hover((s) => s.bg(t.hover))
                    .on_click((_e, cx) => {
                      cx.stop_propagation();
                      this.setColor("", cx);
                    })
                    .child("Let Herdr choose"),
                )
                .child(div().text_size(11).text_color(t.dim).child(color ? color : "no colour of its own")))
              .child(h_flex().items_center().gap(8).child(div().text_size(11).text_color(t.dim).child("As the row wears it")).child(div().flex_1()))
              .child(this.preview(t, space, color, icon)),
          ),
      )
      .child(
        h_flex()
          .justify_end()
          .child(
            h_flex()
              .id("look-close")
              .h(30)
              .px(13)
              .items_center()
              .rounded(8)
              .bg(t.raised)
              .text_color(t.foreground)
              .cursor_pointer()
              .hover((s) => s.opacity(0.9))
              .on_click(() => closeOverlay(props().overlay))
              .child("Close"),
          ),
      );
  }
}
