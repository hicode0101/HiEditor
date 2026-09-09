// CodeMirror 6 封装入口（经 esbuild 打包为 ui/vendor/cm.js 供主代码动态 import）。
// 导出 createEditor：含语言 compartment（JSON/XML/Markdown + code 插件 15 门语言高亮）、
// 亮/暗主题 compartment、自动换行 compartment、撤销/重做（FR-17 高亮配色表在此落地）。

import { EditorView, keymap, drawSelection, highlightActiveLine } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import {
  defaultKeymap, history, historyKeymap, indentWithTab, undo, redo,
} from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { markdown } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { go } from "@codemirror/lang-go";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { StreamLanguage, syntaxHighlighting, HighlightStyle, indentUnit } from "@codemirror/language";
import { search, searchKeymap, openSearchPanel } from "@codemirror/search";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { csharp } from "@codemirror/legacy-modes/mode/clike";
import { tags as t } from "@lezer/highlight";

export { undo, redo, openSearchPanel };

// 搜索/替换面板本地化词条（FR-4）：i18n 侧经 setPhrases 注入，切标签重建时生效
let phraseMap = {};
export function setPhrases(map) {
  phraseMap = map || {};
}

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
  // Markdown / 文档标记
  { tag: t.heading, color: "#0000ff", "font-weight": "bold" },
  { tag: t.strong, color: "#1b1b1b", "font-weight": "bold" },
  { tag: t.emphasis, color: "#1b1b1b", "font-style": "italic" },
  { tag: t.strikethrough, color: "#696969", "text-decoration": "line-through" },
  { tag: t.link, color: "#0451a5", "text-decoration": "underline" },
  { tag: t.url, color: "#0451a5" },
  { tag: t.monospace, color: "#a31515" },
  { tag: t.contentSeparator, color: "#800000", "font-weight": "bold" },
  { tag: t.quote, color: "#5a5a5a", "font-style": "italic" },
  { tag: t.processingInstruction, color: "#800000" },
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
  // Markdown / 文档标记
  { tag: t.heading, color: "#569cd6", "font-weight": "bold" },
  { tag: t.strong, color: "#e8e8e8", "font-weight": "bold" },
  { tag: t.emphasis, color: "#e8e8e8", "font-style": "italic" },
  { tag: t.strikethrough, color: "#808080", "text-decoration": "line-through" },
  { tag: t.link, color: "#3794ff", "text-decoration": "underline" },
  { tag: t.url, color: "#3794ff" },
  { tag: t.monospace, color: "#ce9178" },
  { tag: t.contentSeparator, color: "#569cd6", "font-weight": "bold" },
  { tag: t.quote, color: "#808080", "font-style": "italic" },
  { tag: t.processingInstruction, color: "#c586c0" },
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
        // 行高随字号等比缩放（1.5 倍），字号变大时行距同步变大，避免行间挤压
        lineHeight: "calc(var(--editor-font-size) * 1.5 * var(--zoom) / 100)",
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

// Windows 批处理（.bat/.cmd）：legacy-modes 无此模式，内置轻量流式词法
// （注释 ::/REM、@前缀、关键词、:标签、%VAR%/%1/%%p/!VAR! 变量、字符串、数字）
const batchLang = StreamLanguage.define({
  name: "batch",
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^::/)) { stream.skipToEnd(); return "comment"; }
    if (stream.match(/^@\s*rem\b/i) || stream.match(/^rem\b/i)) { stream.skipToEnd(); return "comment"; }
    if (stream.eat("@")) return "meta";
    if (stream.match(/^(?:echo|setlocal|endlocal|set|if|else|for|in|do|goto|call|exit|shift|pause|not|exist|defined|errorlevel|equ|neq|lss|leq|gtr|geq|cd|chdir|md|mkdir|rd|rmdir|del|erase|copy|xcopy|robocopy|move|ren|rename|type|start|pushd|popd|title|cls|color|ver|vol|label|choice|find|findstr|sort|more|tree|attrib|tasklist|taskkill|net)\b/i)) return "keyword";
    if (stream.match(/^:[A-Za-z_][\w.-]*/)) return "label";
    if (stream.match(/^![^!\n]+!/)) return "variable";
    if (stream.match(/^%%?[^%\s]+%?/)) return "variable";
    if (stream.match(/^"(?:[^"\n]|"")*"/)) return "string";
    if (stream.match(/^\d+/)) return "number";
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "rem" } },
});

const langResolver = {
  json: () => json(),
  xml: () => xml(),
  markdown: () => markdown(),
  // code 插件注册的 15 门语言（FR-17.2）：官方 Lezer 包 + legacy-modes 流式模式
  html: () => html(),
  css: () => css(),
  javascript: () => javascript(),
  typescript: () => javascript({ typescript: true, jsx: true }),
  python: () => python(),
  java: () => java(),
  cpp: () => cpp(),
  go: () => go(),
  rust: () => rust(),
  sql: () => sql(),
  yaml: () => StreamLanguage.define(yaml),
  shell: () => StreamLanguage.define(shell),
  ini: () => StreamLanguage.define(properties), // .ini/.cfg/.conf 键值语法（.toml 同 ID 近似覆盖）
  csharp: () => StreamLanguage.define(csharp),
  batch: () => batchLang, // 自定义流式词法（legacy-modes 无 Batch 模式）
  // batch（.bat/.cmd）之外全部语言已接入
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
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    search({ top: true }), // 查找/替换面板置顶（FR-4）
    EditorState.phrases.of(phraseMap),
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
