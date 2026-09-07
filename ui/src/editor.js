// 编辑区（UI-3/UI-6）：CodeMirror 6 内核承载（虚拟滚动、语法高亮、IME、撤销）。
// 本模块是适配层：对外提供与 textarea 时代相同的函数签名，内部全部走 CM6 dispatch。
// 语法高亮配色见 ui/src-cm/cm-entry.js（FR-17.4）。

import { state, activeTab } from "./state.js";
import { scheduleSessionSave } from "./session.js";
import { undo as cmUndo, redo as cmRedo } from "/vendor/cm.js";

let cm = null; // createEditor 返回的 API（view/setDoc/setLanguage/setDark/setWrap/focus）
let wrapOn = false;

export function initEditorInstance(api) {
  cm = api;
  api.view.scrollDOM.addEventListener("scroll", () => {
    const tab = activeTab();
    if (tab) tab.scroll = api.view.scrollDOM.scrollTop;
  });
}

export function editorHostEl() {
  return document.getElementById("editor");
}

export function focusEditor() {
  if (cm) cm.focus();
}

export function isEditorReady() {
  return !!cm;
}

export function getDocText() {
  return cm ? cm.view.state.doc.toString() : "";
}

export function replaceDoc(text) {
  if (!cm) return;
  cm.view.dispatch({ changes: { from: 0, to: cm.view.state.doc.length, insert: text } });
}

export function getSelectionRange() {
  const m = cm.view.state.selection.main;
  return { from: m.from, to: m.to };
}

export function getSelectedText() {
  const { from, to } = getSelectionRange();
  return cm.view.state.sliceDoc(from, to);
}

export function setSelection(from, to) {
  cm.view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
}

export function selectAll() {
  if (!cm) return;
  cm.view.dispatch({ selection: { anchor: 0, head: cm.view.state.doc.length }, scrollIntoView: true });
  focusEditor();
}

export function deleteSelection() {
  const { from, to } = getSelectionRange();
  if (from === to) return;
  cm.view.dispatch({ changes: { from, to } });
  markDirty();
}

// ===== 标签页装载/持久化 =====

export function loadActiveIntoEditor() {
  const tab = activeTab();
  if (!tab || !cm) return;
  cm.setState({
    doc: tab.text,
    langId: tab.lang,
    dark: isDarkTheme(),
    wrap: wrapOn,
    scroll: tab.scroll,
    cursor: tab.cursor,
  });
  updateStatus();
}

export function persistActiveFromEditor() {
  const tab = activeTab();
  if (!tab || !cm) return;
  tab.text = cm.view.state.doc.toString();
  tab.scroll = cm.view.scrollDOM.scrollTop;
  tab.cursor = cm.view.state.selection.main.head;
}

// ===== 状态栏（UI-4）=====

export function updateStatus() {
  const tab = activeTab();
  if (!tab || !cm) return;
  const doc = cm.view.state.doc;
  const head = cm.view.state.selection.main.head;
  const line = doc.lineAt(head);
  document.getElementById("st-linecol").textContent = `行 ${line.number}, 列 ${head - line.from + 1}`;
  const chars = [...doc.toString()].length; // Unicode 码点计数（FR-3.8）
  document.getElementById("st-chars").textContent = `${chars} 个字符`;
  document.getElementById("st-lang").textContent = langLabel(tab);
  document.getElementById("st-eol").textContent = eolLabel(tab.eol);
  document.getElementById("st-enc").textContent = encLabel(tab.encoding);
}

function langLabel(tab) {
  const l = state.registry.languages.find((x) => x.id === tab.lang);
  return l ? l.name : tab.lang === "plaintext" ? "纯文本" : tab.lang;
}
function eolLabel(key) {
  const hit = state.registry.eols.find(([k]) => k === key);
  return hit ? hit[1] : key;
}
function encLabel(key) {
  const hit = state.registry.encodings.find(([k]) => k === key);
  return hit ? hit[1] : key;
}

// ===== 视图设置 =====

export function isWrapOn() {
  return wrapOn;
}

export function setWrap(on) {
  wrapOn = on;
  if (cm) cm.setWrap(on);
}

export function setEditorDark(dark) {
  if (cm) cm.setDark(dark);
}

export function setEditorLanguage(langId) {
  if (cm) cm.setLanguage(langId);
}

export function setZoom(percent) {
  const tab = activeTab();
  if (tab) tab.zoom = percent;
  document.documentElement.style.setProperty("--zoom", String(percent));
  const seg = document.getElementById("st-zoom");
  if (seg) seg.textContent = `${percent}%`;
}

export function getZoom() {
  const tab = activeTab();
  return tab ? tab.zoom : 100;
}

// ===== 编辑原语（FR-3 / FR-7.4 源码模式）=====

export function markDirty() {
  const tab = activeTab();
  if (tab && !tab.dirty) {
    tab.dirty = true;
    window.dispatchEvent(new CustomEvent("tabs-refresh"));
  }
  const ed = document.getElementById("editor");
  if (tab) document.title = `${tab.title}${tab.dirty ? " *" : ""} - HiEditor`;
  scheduleSessionSave();
  updateStatus();
}

export function replaceSelection(before, after, placeholder = "") {
  const view = cm.view;
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const inner = selected || placeholder;
  const insert = before + inner + after;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + before.length, head: from + before.length + inner.length },
    scrollIntoView: true,
  });
  view.focus();
  markDirty();
}

export function transformSelection(fn) {
  const view = cm.view;
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  view.dispatch({
    changes: { from, to, insert: fn(selected) },
    selection: { anchor: from, head: from + fn(selected).length },
    scrollIntoView: true,
  });
  view.focus();
  markDirty();
}

function dispatchLines(fn) {
  const view = cm.view;
  const { from, to } = view.state.selection.main;
  const startLine = view.state.doc.lineAt(from);
  const endLine = view.state.doc.lineAt(to);
  const changes = [];
  let pos = 0;
  const newSelections = [];
  for (let n = startLine.number; n <= endLine.number; n++) {
    const line = view.state.doc.line(n);
    const replaced = fn(line.text);
    changes.push({ from: line.from, to: line.to, insert: replaced });
    if (n === startLine.number) newSelections.push({ from: line.from, to: line.from + replaced.length });
    pos = replaced.length;
  }
  view.dispatch({ changes, selection: { anchor: newSelections[0].from, head: newSelections[0].to }, scrollIntoView: true });
  view.focus();
  markDirty();
}

export function setHeading(level) {
  const prefix = level === 0 ? "" : "#".repeat(level) + " ";
  dispatchLines((line) => prefix + line.replace(/^#{1,6}\s*/, ""));
}

export function toggleLinePrefix(prefix) {
  dispatchLines((line) => {
    const stripped = line.replace(/^(\s*)([-*+] |\d+\. |- \[[ x]\] |> )/, "$1");
    return stripped.startsWith(prefix) ? stripped : prefix + stripped;
  });
}

export function toggleNumberedPrefix() {
  const view = cm.view;
  const { from, to } = view.state.selection.main;
  const startLine = view.state.doc.lineAt(from);
  const endLine = view.state.doc.lineAt(to);
  const lines = [];
  for (let n = startLine.number; n <= endLine.number; n++) {
    lines.push(view.state.doc.line(n).text);
  }
  const allNumbered = lines.every((l) => /^\s*\d+\. /.test(l));
  const out = lines
    .map((l, i) => {
      const stripped = l.replace(/^(\s*)(\d+\. |[-*+] |- \[[ x]\] )/, "$1");
      return allNumbered ? stripped : stripped.replace(/^(\s*)/, `$1${i + 1}. `);
    })
    .join("\n");
  view.dispatch({
    changes: { from: startLine.from, to: endLine.to, insert: out },
    selection: { anchor: startLine.from, head: startLine.from + out.length },
    scrollIntoView: true,
  });
  view.focus();
  markDirty();
}

export function insertBlock(text) {
  const view = cm.view;
  const s = view.state.selection.main.head;
  const line = view.state.doc.lineAt(s);
  const atLineStart = s === line.from;
  const insert = (atLineStart ? "" : "\n") + text;
  view.dispatch({
    changes: { from: s, insert },
    selection: { anchor: s + insert.length },
    scrollIntoView: true,
  });
  view.focus();
  markDirty();
}

// ===== 剪贴板（FR-3.2）=====

export async function copySelection() {
  const { from, to } = getSelectionRange();
  const text = cm.view.state.sliceDoc(from, to);
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    /* WebView2 剪贴板写入一般直接可用 */
  }
}

export async function cutSelection() {
  await copySelection();
  deleteSelection();
  focusEditor();
}

export async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      cm.view.dispatch({
        changes: { from: getSelectionRange().from, to: getSelectionRange().to, insert: text },
        selection: { anchor: getSelectionRange().from + text.length },
        scrollIntoView: true,
      });
      markDirty();
      focusEditor();
    }
  } catch (e) {
    // 读取被拒时提示用户用原生 Ctrl+V（CM6 原生支持）
    const { showBanner } = await import("./ui.js");
    showBanner({ message: "请在编辑区内按 Ctrl+V 粘贴。", info: true, autoHideMs: 2000 });
  }
}

export function editorUndo() {
  focusEditor();
  if (cm) cmUndo(cm.view);
}
export function editorRedo() {
  focusEditor();
  if (cm) cmRedo(cm.view);
}

function isDarkTheme() {
  return document.documentElement.dataset.theme === "dark";
}
