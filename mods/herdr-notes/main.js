// The to-do list and the notes kept with a space. Opened as a dialog with props
// { space }. Everything lives in the shared store, so it survives a restart and
// every copy of this mod sees the same list.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, theme, spaces, shared, setShared, closeOverlay } from "herdr";

const KEY = "herdr.notes";

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// The list, as a copy: what is written back is what was changed.
function store() {
  const v = shared(KEY);
  const s = v && typeof v === "object" ? v : {};
  const global = (s.global ?? []).map((i) => ({ ...i }));
  const spaces_ = {};
  for (const [id, list] of Object.entries(s.spaces ?? {})) spaces_[id] = (list ?? []).map((i) => ({ ...i }));
  return { global, spaces: spaces_ };
}

export default class Notes extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.draft = {
      global: InputState.new({ placeholder: "An idea to come back to…" }),
      space: InputState.new({ placeholder: "A note for this space…" }),
    };
    for (const scope of ["global", "space"]) this.draft[scope].on("submit", (_e, cx) => this.add(scope, cx));
    this.editing = null; // { scope, id, state }
  }

  spaceId() {
    const p = props() ?? {};
    return p.space ?? spaces().find((s) => s.active)?.id ?? null;
  }

  list(scope) {
    const v = store();
    if (scope === "global") return v.global;
    const id = this.spaceId();
    return id ? (v.spaces[id] ?? []) : [];
  }

  add(scope, cx) {
    const text = this.draft[scope].value().trim();
    if (!text) return;
    const v = store();
    const item = { id: uid(), text, done: false };
    if (scope === "global") v.global = [...v.global, item];
    else {
      const id = this.spaceId();
      if (!id) return;
      v.spaces[id] = [...(v.spaces[id] ?? []), item];
    }
    setShared(KEY, v);
    this.draft[scope].set_value("");
    cx.notify();
  }

  toggle(scope, item, cx) {
    const v = store();
    const list = scope === "global" ? v.global : (v.spaces[this.spaceId()] ?? []);
    const found = list.find((i) => i.id === item.id);
    if (!found) return;
    found.done = !found.done;
    setShared(KEY, v);
    cx.notify();
  }

  drop(scope, item, cx) {
    const v = store();
    if (scope === "global") v.global = v.global.filter((i) => i.id !== item.id);
    else {
      const id = this.spaceId();
      v.spaces[id] = (v.spaces[id] ?? []).filter((i) => i.id !== item.id);
    }
    setShared(KEY, v);
    if (this.editing?.id === item.id) this.editing = null;
    cx.notify();
  }

  edit(scope, item, cx) {
    if (this.editing?.id === item.id) return;
    const state = InputState.new({ value: item.text });
    state.on("submit", () => this.saveEdit(scope, item.id, state.value()));
    state.on("blur", () => this.saveEdit(scope, item.id, state.value()));
    this.editing = { scope, id: item.id, state };
    cx.notify();
  }

  saveEdit(scope, id, text) {
    const value = text.trim();
    if (!value) return;
    const v = store();
    const list = scope === "global" ? v.global : (v.spaces[this.spaceId()] ?? []);
    const found = list.find((i) => i.id === id);
    if (found && found.text !== value) {
      found.text = value;
      setShared(KEY, v);
    }
    if (this.editing?.id === id) this.editing = null;
  }

  item(scope, it, t, cx) {
    const editing = this.editing?.id === it.id;
    const box = h_flex()
      .id(`note-box-${it.id}`)
      .w(18)
      .flex_none()
      .justify_center()
      .items_center()
      .cursor_pointer()
      .child(div().size(12).rounded(3).border_1().border_color(it.done ? t.done : t.border).bg(it.done ? t.done : t.popover).when(it.done, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(9).text_color(t.background))));
    return h_flex()
      .id(`note-${it.id}`)
      .min_h(28)
      .px(6)
      .gap(8)
      .rounded(7)
      .items_center()
      .hover((s) => s.bg(t.hover))
      .child(box.on_click(() => this.toggle(scope, it, cx)))
      .child(
        editing
          ? Input.new(this.editing.state).flex_1().h(24).px(6).rounded(6).border_1().border_color(t.accent).bg(t.background)
          : h_flex()
              .flex_1()
              .min_w(0)
              .items_center()
              .cursor_pointer()
              .on_click(() => this.edit(scope, it, cx))
              .child(div().flex_1().truncate().text_size(12.5).text_color(it.done ? t.dim : t.foreground).child(it.text)),
      )
      .child(
        h_flex()
          .id(`note-drop-${it.id}`)
          .w(20)
          .flex_none()
          .justify_center()
          .items_center()
          .cursor_pointer()
          .opacity(0.55)
          .hover((s) => s.opacity(1).text_color(t.blocked))
          .on_click(() => this.drop(scope, it, cx))
          .child(svg("mods/workspace-chrome/x.svg").size(12)),
      );
  }

  section(scope, title, hint, t, cx) {
    const list = this.list(scope);
    return v_flex()
      .gap(7)
      .child(
        h_flex()
          .items_center()
          .gap(8)
          .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child(title))
          .child(div().text_size(11).text_color(t.dim).child(hint))
          .child(div().flex_1()),
      )
      .child(
        v_flex()
          .gap(2)
          .children(list.length ? list.map((i) => this.item(scope, i, t, cx)) : [div().px(2).py(4).text_size(11.5).text_color(t.dim).child("Nothing here yet.")]),
      )
      .child(Input.new(this.draft[scope]).h(30).px(9).rounded(8).border_1().border_color(t.input).bg(t.background));
  }

  render(cx) {
    const t = theme();
    const p = props() ?? {};
    const space = spaces().find((s) => s.id === p.space) ?? spaces().find((s) => s.active);
    return v_flex()
      .id("herdr-notes")
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
          .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Notes"))
          .child(div().flex_1())
          .child(div().text_size(11).text_color(t.dim).child("Esc to close")),
      )
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .gap(14)
          .child(this.section("global", "Everywhere", "ideas that belong to no one space", t, cx))
          .child(this.section("space", space ? space.name : "This space", "kept with this space", t, cx)),
      )
      .child(
        h_flex()
          .justify_end()
          .child(
            h_flex()
              .id("notes-close")
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
