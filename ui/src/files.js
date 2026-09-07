// 文件操作（FR-2）：打开 / 保存 / 另存为 / 关闭确认，全部经 Tauri 命令走 Rust 核心。

import { state, activeTab, newTabModel, langForPath } from "./state.js";
import { loadActiveIntoEditor, persistActiveFromEditor } from "./editor.js";
import { showDialog, showBanner } from "./ui.js";

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
    filters: [{ name: "所有文件", extensions: ["*"] }],
  });
}

export async function saveDialog(defaultName) {
  return window.__TAURI__.dialog.save({
    defaultPath: defaultName || "无标题.txt",
    filters: [{ name: "所有文件", extensions: ["*"] }],
  });
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
  const out = await invoke("read_file", { path });
  addRecent(path);
  const tab = newTabModel({
    title: basename(path),
    path,
    text: out.text,
    encoding: out.encoding,
    eol: out.eol,
    lang: langForPath(path),
  });
  state.tabs.push(tab);
  if (activate) switchTab(tab.id);
  else refreshTabs();
  if (out.lossy) {
    switchTab(tab.id);
    showBanner({
      message: "部分字符无法正确解码，已按检测编码打开。",
      buttons: [{ label: "知道了" }],
    });
  }
  window.dispatchEvent(new CustomEvent("tab-updated", { detail: tab.id }));
  return tab;
}

export async function openFile() {
  const path = await openFileDialog();
  if (path) await openPath(path);
}

export function newTab() {
  const used = new Set(state.tabs.filter((t) => !t.path).map((t) => t.title));
  let title = "无标题";
  for (let i = 2; used.has(title); i++) title = `无标题 ${i}`;
  const tab = newTabModel({ title, lang: state.settings.new_tab_language || "plaintext" });
  state.tabs.push(tab);
  switchTab(tab.id);
  return tab;
}

export async function saveTab(tab, { as = false } = {}) {
  persistActiveFromEditor();
  let path = tab.path;
  if (!path || as) {
    path = await saveDialog(tab.title);
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
  if (!tab.lang || tab.lang === "plaintext") tab.lang = langForPath(path);
  refreshTabs();
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

export async function closeTab(id) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return;
  if (tab.dirty && state.settings.confirm_close !== false) {
    const choice = await showDialog({
      title: `是否将更改保存到 ${tab.title}?`,
      buttons: [
        { label: "保存", primary: true, value: "save" },
        { label: "不保存", value: "discard" },
        { label: "取消", value: null },
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
