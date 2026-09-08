// CodeMirror 6 封装入口（经 esbuild 打包为 ui/vendor/cm.js 供主代码动态 import）。
// 导出 createEditor：含语言 compartment（JSON/XML/Markdown 高亮）、亮/暗主题 compartment、
// 自动换行 compartment、撤销/重做（FR-17 高亮配色表在此落地）。

import { EditorView, keymap, drawSelection, highlightActiveLine } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import {
  defaultKeymap, history, historyKeymap, indentWithTab, undo, redo,
} from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, HighlightStyle, indentUnit } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

export { undo, redo };

const MONO = '"Cascadia Mono", Consolas, "SF Mono", Menlo, "DejaVu Sans Mono", "Microsoft YaHei Mono", monospace';

// FR-17.4 浅色高亮配色
const lightHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "#0000ff" },
  { tag: [t.controlKeyword, t.moduleKeyword], color: "#af00db" },
  { tag: t.string, color: "#a31515" },
  { tag: t.number, color: "#098658" },
  { tag: t.comment, color: "#008000" },
  { tag: t.propertyName, color: "#0451a5" },
  { tag: t.labelName, color: "#0451a5" },
  { tag: t.tagName, color: "#800000" },
  { tag: t.attributeName, color: "#e50000" },
  { tag: t.typeName, color: "#267f99" },
  { tag: t.function(t.variableName), color: "#795e26" },
  { tag: t.definition(t.variableName), color: "#001080" },
  { tag: t.variableName, color: "#001080" },
  { tag: [t.bool, t.null], color: "#0000ff" },
  { tag: t.constant(t.name), color: "#0070c1" },
  { tag: t.operator, color: "#1b1b1b" },
]);

// 深色高亮配色（附录 B 深色配色表）
const darkHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "#569cd6" },
  { tag: [t.controlKeyword, t.moduleKeyword], color: "#c586c0" },
  { tag: t.string, color: "#ce9178" },
  { tag: t.number, color: "#b5cea8" },
  { tag: t.comment, color: "#6a9955" },
  { tag: t.propertyName, color: "#9cdcfe" },
  { tag: t.labelName, color: "#9cdcfe" },
  { tag: t.tagName, color: "#569cd6" },
  { tag: t.attributeName, color: "#9cdcfe" },
  { tag: t.typeName, color: "#4ec9b0" },
  { tag: t.function(t.variableName), color: "#dcdcaa" },
  { tag: t.definition(t.variableName), color: "#9cdcfe" },
  { tag: t.variableName, color: "#9cdcfe" },
  { tag: [t.bool, t.null], color: "#569cd6" },
  { tag: t.constant(t.name), color: "#4fc1ff" },
  { tag: t.operator, color: "#d4d4d4" },
]);

function editorTheme(dark) {
  return EditorView.theme(
    {
      "&": {
        height: "100%",
        color: dark ? "#e8e8e8" : "#1b1b1b",
        backgroundColor: dark ? "#2b2b2b" : "#ffffff",
      },
      ".cm-content": {
        fontFamily: "var(--editor-font-family, Cascadia Mono, Consolas, Menlo, monospace)",
        caretColor: dark ? "#e8e8e8" : "#1b1b1b",
        fontSize: "calc(var(--editor-font-size) * var(--zoom) / 100)",
        lineHeight: "calc(var(--editor-line-height) * var(--zoom) / 100)",
        padding: "8px 0 30vh",
      },
      "&.cm-focused": { outline: "none" },
      ".cm-scroller": { fontFamily: MONO, overflow: "auto" },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: dark ? "#e8e8e8" : "#1b1b1b",
        borderLeftWidth: "1.5px",
      },
      ".cm-selectionBackground": {
        backgroundColor: dark ? "#294d6e" : "#add6ff",
      },
      "&.cm-focused .cm-selectionBackground": {
        backgroundColor: dark ? "#294d6e" : "#add6ff",
      },
    },
    { dark }
  );
}

function themePack(dark) {
  return [
    editorTheme(dark),
    syntaxHighlighting(dark ? darkHighlight : lightHighlight),
  ];
}

const langResolver = {
  json: () => json(),
  xml: () => xml(),
  markdown: () => markdown(),
};

export function langExtFor(langId) {
  const f = langResolver[langId];
  return f ? f() : [];
}

export function createEditor(parent, { doc, langId, dark, wrap, tabWidth, onUpdate }) {
  const langComp = new Compartment();
  const themeComp = new Compartment();
  const wrapComp = new Compartment();
  const indent = indentUnit.of(" ".repeat(tabWidth || 4));

  const buildExtensions = (langId2, dark2, wrap2) => [
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    drawSelection(),
    langComp.of(langExtFor(langId2)),
    themeComp.of(themePack(dark2)),
    wrapComp.of(wrap2 ? EditorView.lineWrapping : []),
    highlightActiveLine(),
    indent,
    EditorView.updateListener.of((u) => {
      if (onUpdate) onUpdate(u);
    }),
    EditorView.contentAttributes.of({ spellcheck: "false" }),
  ];

  const view = new EditorView({
    state: EditorState.create({ doc, extensions: buildExtensions(langId, dark, wrap) }),
    parent,
  });

  return {
    view,
    setDoc(text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    },
    // 切换标签：整体替换 EditorState（撤销栈随标签独立，compartments 配置复用）
    setState(opts) {
      const st = EditorState.create({
        doc: opts.doc,
        selection: { anchor: Math.min(opts.cursor || 0, opts.doc.length) },
        extensions: buildExtensions(opts.langId, opts.dark, opts.wrap),
      });
      view.setState(st);
      view.scrollDOM.scrollTop = opts.scroll || 0;
    },
    setLanguage(langId2) {
      view.dispatch({ effects: langComp.reconfigure(langExtFor(langId2)) });
    },
    setDark(dark2) {
      view.dispatch({ effects: themeComp.reconfigure(themePack(dark2)) });
    },
    setWrap(w) {
      view.dispatch({ effects: wrapComp.reconfigure(w ? EditorView.lineWrapping : []) });
    },
    focus() {
      view.focus();
    },
  };
}
