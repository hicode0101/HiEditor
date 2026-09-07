// 总装：启动加载注册表/设置 → 初始标签 → 全局快捷键 → 窗口控制

import { state, activeTab, newTabModel, langForPath } from "./state.js";
import { initTitlebar, syncCaptionGlyph } from "./titlebar.js";
import { initMenus } from "./menus.js";
import { initToolbars } from "./toolbar.js";
import { initStatusbar } from "./statusbar.js";
import { openSettings, closeSettings } from "./settings.js";
import { newTab, switchTab, openPath, saveActive, saveActiveAs, saveAll, closeTab } from "./files.js";
import { setZoom, setWrap, updateStatus, editorEl } from "./editor.js";
import { setIcon } from "./icons.js";
import { applyTheme } from "./theme.js";

const invoke = (...args) => window.__TAURI__.core.invoke(...args);

async function boot() {
  // 填充所有 data-ico 图标（4.6 图标清单；kebab-case → camelCase 映射 ICONS 键）
  document.querySelectorAll("[data-ico]").forEach((el) => {
    const key = el.dataset.ico.replace(/-(\w)/g, (_, c) => c.toUpperCase());
    setIcon(el, key);
  });

  initTitlebar();
  initMenus();
  initToolbars();
  initStatusbar();

  state.registry = await invoke("get_registry");
  state.settings = await invoke("get_settings");
  applyTheme(state.settings.theme || "light");
  document.documentElement.style.setProperty(
    "--editor-font-size",
    `${state.settings.font_size || 15}px`
  );
  editorEl().style.setProperty("tab-size", state.settings.tab_width || 4);
  if (state.settings.wrap_default) setWrap(true);

  // 初始标签（无会话恢复的默认路径；会话恢复在 M2 接入 FR-10）
  const tab = newTabModel({ lang: state.settings.new_tab_language || "plaintext" });
  state.tabs.push(tab);
  switchTab(tab.id);

  bindGlobalKeys();
  bindEditorEvents();
  await initDragDrop();
  syncCaptionGlyph();
}

// 拖放打开文件（FR-12.1）：WebView 拦截系统拖放，必须订阅 Tauri 原生事件才能拿到绝对路径。
async function initDragDrop() {
  const overlay = document.createElement("div");
  overlay.id = "drop-overlay";
  overlay.textContent = "松开以在 HiEditor 中打开";
  overlay.hidden = true;
  document.body.appendChild(overlay);

  const openPaths = async (paths) => {
    for (const path of paths || []) {
      if (path) await openPath(path);
    }
  };

  if (!window.__TAURI__) return;
  try {
    // Tauri 2：onDragDropEvent（enter/over/drop/leave）
    const webview = window.__TAURI__.webview.getCurrentWebview();
    await webview.onDragDropEvent((event) => {
      const p = event.payload || {};
      if (p.type === "enter" || p.type === "over") {
        overlay.hidden = false;
      } else if (p.type === "leave") {
        overlay.hidden = true;
      } else if (p.type === "drop") {
        overlay.hidden = true;
        openPaths(p.paths);
      }
    });
    return;
  } catch (e) {
    // 旧运行时回退：按事件名订阅
  }
  if (window.__TAURI__.event) {
    const { listen } = window.__TAURI__.event;
    await listen("tauri://drag-drop", (e) => {
      overlay.hidden = true;
      openPaths(e.payload && e.payload.paths);
    });
    await listen("tauri://drag-enter", () => (overlay.hidden = false));
    await listen("tauri://drag-leave", () => (overlay.hidden = true));
  }
}

function switchToolbar() {
  const tab = activeTab();
  const isMd = tab && tab.lang === "markdown" && state.registry.markdownLoaded;
  document.getElementById("toolbar-default").hidden = !!isMd;
  document.getElementById("toolbar-markdown").hidden = !isMd;
}

function bindGlobalKeys() {
  window.addEventListener("keydown", (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && !e.shiftKey && key === "n") { e.preventDefault(); newTab(); }
    else if (ctrl && !e.shiftKey && key === "t") { e.preventDefault(); newTab(); }
    else if (ctrl && !e.shiftKey && key === "o") { e.preventDefault(); openFile(); }
    else if (ctrl && !e.shiftKey && key === "s") { e.preventDefault(); saveActive(); }
    else if (ctrl && e.shiftKey && key === "s") { e.preventDefault(); saveActiveAs(); }
    else if (ctrl && e.altKey && key === "s") { e.preventDefault(); saveAll(); }
    else if (ctrl && !e.shiftKey && key === "w") { e.preventDefault(); const t = activeTab(); if (t) closeTab(t.id); }
    else if (ctrl && (key === "=" || key === "+")) { e.preventDefault(); zoom(10); }
    else if (ctrl && key === "-") { e.preventDefault(); zoom(-10); }
    else if (ctrl && key === "0") { e.preventDefault(); zoom(0); }
    else if (e.altKey && key === "z") { e.preventDefault(); toggleWrap(); }
    else if (key === "f5") { e.preventDefault(); insertTimeDate(); }
    else if (ctrl && e.shiftKey && key === "j") { e.preventDefault(); runFormatterById("json.pretty"); }
    else if (ctrl && e.altKey && key === "j") { e.preventDefault(); runFormatterById("json.minify"); }
    else if (ctrl && e.shiftKey && key === "l") { e.preventDefault(); runFormatterById("xml.pretty"); }
    else if (ctrl && e.altKey && key === "l") { e.preventDefault(); runFormatterById("xml.minify"); }
  });

  document.addEventListener("wheel", (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      zoom(e.deltaY < 0 ? 5 : -5);
    }
  }, { passive: false });

  window.addEventListener("zoom", (e) => zoom(e.detail));
  window.addEventListener("toggle-wrap", toggleWrap);
  window.addEventListener("request-save", saveActive);
  window.addEventListener("tab-switched", switchToolbar);
  window.addEventListener("tabs-refresh", switchToolbar);
  document.getElementById("btn-settings").addEventListener("click", () =>
    state.settingsOpen ? closeSettings() : openSettings()
  );
}

function zoom(delta) {
  const current = getZoomSafe();
  const next = delta === 0 ? 100 : Math.max(30, Math.min(500, current + delta));
  setZoom(next);
}

function getZoomSafe() {
  const t = activeTab();
  return t ? t.zoom : 100;
}

function toggleWrap() {
  const ed = editorEl();
  setWrap(!ed.classList.contains("wrap"));
}

function insertTimeDate() {
  import("./editor.js").then(({ replaceSelection }) => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    replaceSelection("", "", `${hh}:${mm} ${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`);
  });
}

async function runFormatterById(id) {
  const f = state.registry.formatters.find((x) => x.id === id);
  const tab = activeTab();
  if (!f || !tab) return;
  if (tab.lang !== f.language) return;
  try {
    const out = await invoke("format_text", {
      formatterId: id,
      text: editorEl().value,
      indent: state.settings.format_indent ?? 4,
    });
    editorEl().value = out;
    tab.text = out;
    tab.dirty = true;
    tab.eol = tab.eol; // 换行符由保存时统一
    updateStatus();
  } catch (e) {
    const { showDialog } = await import("./ui.js");
    const label = f.label || id;
    showDialog({ title: `${label}失败`, body: String(e) });
  }
}

function bindEditorEvents() {
  const ed = editorEl();
  ed.addEventListener("input", () => {
    const tab = activeTab();
    if (!tab) return;
    tab.text = ed.value;
    if (!tab.dirty) {
      tab.dirty = true;
      window.dispatchEvent(new CustomEvent("tabs-refresh"));
    }
    updateStatus();
    // 轻量状态栏更新：同时刷新窗口标题脏标记
    document.title = `${tab.title}${tab.dirty ? " *" : ""} - HiEditor`;
  });
  ["keyup", "click"].forEach((ev) => ed.addEventListener(ev, updateStatus));
  ed.addEventListener("scroll", () => {
    const tab = activeTab();
    if (tab) tab.scroll = ed.scrollTop;
  });
  ed.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      ed.setRangeText("\t", ed.selectionStart, ed.selectionEnd, "end");
      const tab = activeTab();
      if (tab) { tab.dirty = true; }
      updateStatus();
    }
  });
  // 打开文件后刷新
  window.addEventListener("tab-updated", switchToolbar);
}

boot();
