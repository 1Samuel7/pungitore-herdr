// The confirmation before a to-do is sent to an agent.
//
// Opened as a dialog with props { space, folder, name, text, hint }. The to-do
// comes in already written in the box, so it can be changed before it goes
// out; the hint says what the session is going to do with it. Enter sends it,
// Esc cancels.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, theme, notify } from "herdr";

export default class Confirm extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.space = p.space ?? null;
    this.folder = p.folder ?? null;
    this.name = p.name ?? "";
    this.hint = p.hint ?? "";
    this.input = InputState.new({ value: p.text ?? "", placeholder: "The message for the agent…" });
    this.input.on("submit", () => this.send());
    this.inputFocused = true;
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.input.focus();
    // The keyboard is not on the input yet when the dialog opens.
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  // The message goes out as the first message of a new Claude session in the
  // space the to-do came from.
  send() {
    const text = this.input.value().trim();
    if (!text || !this.space) {
      closeOverlay(props()?.overlay);
      return;
    }
    run("tab.new", { space: this.space, folder: this.folder, argv: ["claude"], task: text });
    notify({ title: this.name, body: text, level: "info" });
    closeOverlay(props()?.overlay);
  }

  render(cx) {
    const t = theme();
    const p = props() ?? {};
    const button = (id, text, primary, action) =>
      h_flex()
        .id(id)
        .h(32)
        .px(14)
        .items_center()
        .rounded(8)
        .border_1()
        .border_color(primary ? t.solid : t.input)
        .bg(primary ? t.solid : t.raised)
        .text_color(primary ? t.solid_foreground : t.foreground)
        .text_size(12.5)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.opacity(0.88))
        .on_click(action)
        .child(text);
    return v_flex()
      .id("pungitore-confirm")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        closeOverlay(p.overlay);
        cx.stop_propagation();
      })
      .w_full()
      .min_h(0)
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_color(t.foreground)
      .child(
        h_flex()
          .items_center()
          .gap(8)
          .child(div().text_size(15).font_semibold().child("Send this to-do?"))
          .child(div().flex_1())
          .child(div().text_size(11).text_color(t.dim).child("Esc")),
      )
      .child(
        div()
          .text_size(11.5)
          .text_color(t.dim)
          .child(this.name ? `A new Claude session in ${this.name}.` : "A new Claude session."),
      )
      .child(
        Input.new(this.input)
          .h(38)
          .px(10)
          .rounded(9)
          .border_1()
          .border_color(this.inputFocused ? t.accent : t.input)
          .bg(t.background)
          .text_size(12.8)
          .text_color(t.foreground),
      )
      .child(div().text_size(11).text_color(t.dim).child("Enter sends it. Change the text first if it needs a better question."))
      .when(this.hint, (el) => el.child(div().text_size(11).text_color(t.muted).child(this.hint)))
      .child(
        h_flex()
          .pt(8)
          .gap(8)
          .justify_end()
          .child(button("pungitore-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
          .child(button("pungitore-send", "Send", true, () => this.send())),
      );
  }
}
