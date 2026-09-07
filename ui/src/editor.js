// 编辑区（UI-3）：单一 textarea 承载活动标签，负责行列统计、缩放、自动换行、
// Markdown 源码插入（FR-7.4 源码模式规则）。WYSIWYG（UI-6）由后续里程碑接入。

import { state, activeTab } from "./state.js";

export const editorEl = () => document.getElementById("editor");

export function loadActiveIntoEditor() {
  const tab = activeTab();
  const ed = editorEl();
  if (!tab) return;
  ed.value = tab.text;
  ed.classList.toggle("wrap", isWrapOn());
  ed.setAttribute("wrap", isWrapOn() ? "soft" : "off");
  ed.scrollTop = tab.scroll;
  ed.selectionStart = ed.selectionEnd = tab.cursor;
  updateStatus();
}

export function persistActiveFromEditor() {
  const tab = activeTab();
  const ed = editorEl();
  if (!tab) return;
  tab.text = ed.value;
  tab.scroll = ed.scrollTop;
  tab.cursor = ed.selectionStart;
}

export function isWrapOn() {
  return document.getElementById("editor").classList.contains("wrap");
}

export function setWrap(on) {
  const ed = editorEl();
  ed.classList.toggle("wrap", on);
  ed.setAttribute("wrap", on ? "soft" : "off");
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

export function updateStatus() {
  const tab = activeTab();
  if (!tab) return;
  const ed = editorEl();
  const upto = ed.value.slice(0, ed.selectionStart);
  const line = (upto.match(/\n/g) || []).length + 1;
  const lastNl = upto.lastIndexOf("\n");
  const col = ed.selectionStart - lastNl;
  document.getElementById("st-linecol").textContent = `行 ${line}, 列 ${col}`;
  const chars = [...ed.value].length; // Unicode 码点计数（FR-3.8）
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

// ===== 源码编辑辅助（FR-7.4） =====

export function replaceSelection(before, after, placeholder = "") {
  const ed = editorEl();
  const { selectionStart: s, selectionEnd: e, value } = ed;
  const selected = value.slice(s, e);
  if (selected) {
    ed.setRangeText(before + selected + after, s, e, "select");
    ed.selectionStart = s + before.length;
    ed.selectionEnd = s + before.length + selected.length;
  } else {
    const text = before + placeholder + after;
    ed.setRangeText(text, s, e, "end");
    ed.selectionStart = s + before.length;
    ed.selectionEnd = s + before.length + placeholder.length;
  }
  markDirty();
  updateStatus();
  ed.focus();
}

export function forEachSelectedLine(fn) {
  const ed = editorEl();
  const { selectionStart: s, selectionEnd: e, value } = ed;
  const lineStart = value.lastIndexOf("\n", s - 1) + 1;
  let lineEnd = value.indexOf("\n", e);
  if (lineEnd === -1) lineEnd = value.length;
  const block = value.slice(lineStart, lineEnd);
  ed.setSelectionRange(lineStart, lineEnd);
  ed.setRangeText(fn(block), lineStart, lineEnd, "end");
  ed.setSelectionRange(lineStart, lineStart + fn(block).length);
  markDirty();
  updateStatus();
  ed.focus();
}

export function setHeading(level) {
  const prefix = level === 0 ? "" : "#".repeat(level) + " ";
  forEachSelectedLine((line) => {
    const stripped = line.replace(/^#{1,6}\s*/, "");
    return prefix + stripped;
  });
}

export function toggleLinePrefix(prefix) {
  forEachSelectedLine((line) => {
    const stripped = line.replace(/^(\s*)([-*+] |\d+\. |- \[[ x]\] )/, "$1");
    const bare = stripped.replace(/^(\s*)/, "$1");
    return bare.startsWith(prefix) ? bare : prefix + bare;
  });
}

export function insertBlock(text) {
  const ed = editorEl();
  const s = ed.selectionStart;
  const atLineStart = s === 0 || ed.value[s - 1] === "\n";
  const insert = (atLineStart ? "" : "\n") + text;
  ed.setRangeText(insert, s, ed.selectionEnd, "end");
  markDirty();
  updateStatus();
  ed.focus();
}

export function markDirty() {
  const tab = activeTab();
  if (tab && !tab.dirty) {
    tab.dirty = true;
    window.dispatchEvent(new CustomEvent("tab-updated", { detail: tab.id }));
  }
}

export function editorStatsText() {
  return editorEl().value;
}
