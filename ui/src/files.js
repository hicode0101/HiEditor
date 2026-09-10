// 文件操作（FR-2）：打开 / 保存 / 另存为 / 关闭确认，全部经 Tauri 命令走 Rust 核心。

import { state, activeTab, newTabModel, langForPath } from "./state.js";
import { loadActiveIntoEditor, persistActiveFromEditor } from "./editor.js";
import { showDialog, syncTabBanner } from "./ui.js";
import { scheduleSessionSave } from "./session.js";
import { t } from "./i18n.js";

const invoke = (...args) => window.__TAURI__.core.invoke(...args);

function basename(path) {
  const norm = path.replace(/\\/g, "/");
  return norm.slice(norm.lastIndexOf("/") + 1);
}

export function addRecent(path) {
  const list = JSON.parse(localStorage.getItem("hi-recents") || "[]");
  const next = [path, ...list.filter((p) => p !== path)].slice(0, 10);
  localStorage.setItem("hi-recents", JSON.stringify(next));
}

export async function openFileDialog() {
  return window.__TAURI__.dialog.open({
    multiple: false,
    filters: [{ name: t("dialog.allFiles"), extensions: ["*"] }],
  });
}

export async function saveDialog(defaultName) {
  return window.__TAURI__.dialog.save({
    defaultPath: defaultName || t("tab.untitled") + ".txt",
    filters: [{ name: t("dialog.allFiles"), extensions: ["*"] }],
  });
}

// 未保存过的新文件默认名：<当前日期_小时分钟>.txt（如 2026-09-07_2230.txt）
export function timestampTxtName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.txt`;
}

export async function openPath(path, { activate = true } = {}) {
  // 同文件已打开 → 定位到已有标签（FR-2.2）
  const norm = path.replace(/\\/g, "/").toLowerCase();
  const existing = state.tabs.find(
    (t) => t.path && t.path.replace(/\\/g, "/").toLowerCase() === norm
  );
  if (existing) {
    if (activate) switchTab(existing.id);
    return existing;
  }
  // PDF（v1.7）：二进制走 pdf.js 查看器，不经文本解码
  if (path.toLowerCase().endsWith(".pdf")) {
    addRecent(path);
    const tab = newTabModel({
      title: basename(path),
      path,
      lang: "pdf",
    });
    state.tabs.push(tab);
    if (activate) switchTab(tab.id);
    else refreshTabs();
    window.dispatchEvent(new CustomEvent("tab-updated", { detail: tab.id }));
    scheduleSessionSave();
    return tab;
  }
  const out = await invoke("read_file", { path });
  addRecent(path);
  const tab = newTabModel({
    title: basename(path),
    path,
    text: out.text,
    encoding: out.encoding,
    eol: out.eol,
    lang: langForPath(path),
    // 文件级提示归属本标签：仅在该标签激活时显示（v1.7）
    banner: out.lossy ? { message: t("banner.lossy") } : null,
  });
  state.tabs.push(tab);
  if (activate) switchTab(tab.id);
  else refreshTabs();
  syncTabBanner(); // activate=false 时横幅等切换到该标签再显示
  window.dispatchEvent(new CustomEvent("tab-updated", { detail: tab.id }));
  scheduleSessionSave();
  return tab;
}

export async function openFile() {
  const path = await openFileDialog();
  if (path) await openPath(path);
}

export function newTab() {
  const used = new Set(state.tabs.filter((t) => !t.path).map((t) => t.title));
  const untitled = t("tab.untitled");
  let title = untitled;
  for (let i = 2; used.has(title); i++) title = `${untitled} ${i}`;
  const tab = newTabModel({ title, lang: state.settings.new_tab_language || "plaintext" });
  state.tabs.push(tab);
  switchTab(tab.id);
  scheduleSessionSave();
  return tab;
}

export async function saveTab(tab, { as = false } = {}) {
  if (tab.lang === "pdf") return false; // PDF 只读，不提供保存
  persistActiveFromEditor();
  let path = tab.path;
  if (!path || as) {
    // 未保存过的新文件：默认名 = <当前日期_小时分钟>.txt（FR-2.4 v1.5）；已有文件沿用当前文件名
    path = await saveDialog(tab.path ? tab.title : timestampTxtName());
    if (!path) return false;
  }
  await invoke("save_file", {
    path,
    text: tab.text,
    encoding: tab.encoding,
    eol: tab.eol,
  });
  tab.path = path;
  tab.title = basename(path);
  tab.dirty = false;
  addRecent(path);
  document.title = `${tab.title} - HiEditor`;
  if (!tab.lang || tab.lang === "plaintext") tab.lang = langForPath(path);
  refreshTabs();
  scheduleSessionSave();
  window.dispatchEvent(new CustomEvent("tab-updated", { detail: tab.id }));
  return true;
}

export async function saveActive() {
  const tab = activeTab();
  if (tab) await saveTab(tab);
}

export async function saveActiveAs() {
  const tab = activeTab();
  if (tab) await saveTab(tab, { as: true });
}

export async function saveAll() {
  for (const tab of [...state.tabs]) {
    if (tab.dirty || !tab.path) await saveTab(tab);
  }
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 打印（FR-2.11）：Windows 调系统 Win32 打印对话框 + GDI 直印；其他平台回退 WebView 打印。
export async function printDocument() {
  persistActiveFromEditor();
  const tab = activeTab();
  if (!tab) return;
  try {
    const r = await invoke("print_text", { title: tab.title, text: tab.text });
    if (r && r !== "cancelled") {
      const { showBanner } = await import("./ui.js");
      showBanner({ message: r, info: true, autoHideMs: 2500 });
    }
    return;
  } catch (e) {
    // 非 Windows / 系统对话框不可用时回退
  }
  legacyPrint(tab);
}

function legacyPrint(tab) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;";
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(tab.title)}</title>` +
    `<style>@page { margin: 2cm; } body { margin: 0; color: #000; ` +
    `font-family: "Cascadia Mono", Consolas, "Courier New", monospace; font-size: 12pt; ` +
    `line-height: 1.5; white-space: pre-wrap; word-break: break-all; }</style></head>` +
    `<body>${escapeHtml(tab.text)}</body></html>`
  );
  doc.close();
  const cleanup = () => iframe.remove();
  iframe.contentWindow.addEventListener("afterprint", cleanup);
  iframe.contentWindow.focus();
  iframe.contentWindow.print();
  setTimeout(cleanup, 120000); // 兜底清理
}

export async function closeTab(id) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return;
  if (tab.dirty && state.settings.confirm_close !== false) {
    const choice = await showDialog({
      title: t("dialog.saveConfirm", { name: tab.title }),
      buttons: [
        { label: t("dialog.save"), primary: true, value: "save" },
        { label: t("dialog.dontSave"), value: "discard" },
        { label: t("dialog.cancel"), value: null },
      ],
    });
    if (choice === null) return;
    if (choice === "save") {
      const ok = await saveTab(tab);
      if (!ok) return;
    }
  }
  const idx = state.tabs.indexOf(tab);
  state.tabs.splice(idx, 1);
  scheduleSessionSave();
  if (state.tabs.length === 0) {
    window.__TAURI__.window.getCurrentWindow().close();
    return;
  }
  if (state.activeId === id) {
    switchTab(state.tabs[Math.min(idx, state.tabs.length - 1)].id);
  } else {
    refreshTabs();
  }
}

export function switchTab(id) {
  persistActiveFromEditor();
  state.activeId = id;
  const tab = activeTab();
  document.title = `${tab.path ? tab.title : tab.title}${tab.dirty ? " *" : ""} - HiEditor`;
  loadActiveIntoEditor();
  refreshTabs();
  window.dispatchEvent(new CustomEvent("tab-switched", { detail: id }));
}

export function refreshTabs() {
  window.dispatchEvent(new CustomEvent("tabs-refresh"));
}
