// 总装：启动加载注册表/设置 → 初始标签 → 全局快捷键 → 窗口控制

import { state, activeTab, newTabModel, langForPath } from "./state.js";
import { initTitlebar, syncCaptionGlyph } from "./titlebar.js";
import { initMenus, initEditorContextMenu } from "./menus.js";
import { initToolbars } from "./toolbar.js";
import { initStatusbar } from "./statusbar.js";
import { openSettings, closeSettings } from "./settings.js";
import { newTab, switchTab, openPath, openFile, saveActive, saveActiveAs, saveAll, closeTab, printDocument } from "./files.js";
import { setZoom, setWrap, isWrapOn, updateStatus, editorHostEl, getDocText, replaceDoc, setEditorDark, initEditorInstance } from "./editor.js";
import { setIcon } from "./icons.js";
import { applyTheme } from "./theme.js";
import * as i18n from "./i18n.js";
import { scheduleSessionSave, flushSession } from "./session.js";

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
  initEditorContextMenu();

  state.registry = await invoke("get_registry");
  state.settings = await invoke("get_settings");
  i18n.setLanguage(state.settings.language || "auto");
  i18n.applyI18n();
  applyEditorFont();
  applyTheme(state.settings.theme || "light");
  setEditorDark((state.settings.theme || "light") === "dark");
  document.documentElement.style.setProperty(
    "--editor-font-size",
    `${state.settings.font_size || 15}px`
  );

  // 编辑器内核（CodeMirror 6）：语法高亮 / IME / 撤销
  // 注意：必须用根路径（/vendor/cm.js），相对路径会被解析到 /src/vendor/ 导致 404
  const cmmod = await import("/vendor/cm.js");
  initEditorInstance(
    cmmod.createEditor(editorHostEl(), {
      doc: "",
      langId: state.settings.new_tab_language || "plaintext",
      dark: (state.settings.theme || "light") === "dark",
      wrap: !!state.settings.wrap_default,
      tabWidth: state.settings.tab_width || 4,
      onUpdate: (u) => handleCmUpdate(u),
    })
  );

  // 会话恢复（FR-10.2）：恢复上次退出/崩溃时的标签（含未保存内容）
  const restored = await restoreSession();
  if (!restored) {
    const tab = newTabModel({ lang: state.settings.new_tab_language || "plaintext" });
    state.tabs.push(tab);
    switchTab(tab.id);
  }

  initFontControls();
  bindGlobalKeys();
  bindEditorEvents();
  switchToolbar(); // 补一次同步：修复恢复/首建标签时工具栏状态未刷新
  await initDragDrop();
  syncCaptionGlyph();
  setInterval(() => flushSession(), 30000); // 30 秒兜底（FR-10.3）
  window.addEventListener("beforeunload", () => { flushSession(); });
}

// 恢复上次会话；返回是否恢复了标签。
async function restoreSession() {
  if (!state.settings.restore_session) return false;
  let sess = null;
  try {
    sess = await invoke("load_session");
  } catch (e) {
    return false; // 会话文件损坏按无会话处理（BR-8）
  }
  if (!sess || !Array.isArray(sess.tabs) || sess.tabs.length === 0) return false;

  let restoredCount = 0;
  for (const st of sess.tabs) {
    if (st.path && st.text === undefined) {
      // 干净的有路径标签：从磁盘重读
      try {
        const t = await openPath(st.path, { activate: false });
        if (t) { t.zoom = st.zoom || 100; restoredCount++; }
      } catch (e) { /* 文件打不开（被删等）→ 跳过该标签 */ }
    } else {
      // 未保存/有未保存修改的标签：直接用会话中的文本重建
      const t = newTabModel({
        title: st.title || i18n.t("tab.untitled"),
        path: st.path || null,
        text: st.text || "",
        dirty: true,
        encoding: st.encoding || "utf8",
        eol: st.eol || "crlf",
        lang: st.lang || "plaintext",
        mode: st.mode || "source",
        zoom: st.zoom || 100,
      });
      state.tabs.push(t);
      restoredCount++;
    }
  }
  if (restoredCount === 0) return false;

  const act = sess.tabs[sess.activeIndex] || sess.tabs[sess.tabs.length - 1];
  const actTitle = act && act.title;
  const actTab = state.tabs.find((t) => act && act.path && t.path === act.path) ||
    state.tabs.find((t) => t.title === actTitle) ||
    state.tabs[state.tabs.length - 1];
  switchTab(actTab.id);

  const { showBanner } = await import("./ui.js");
  showBanner({ message: i18n.t("banner.restored"), info: true, autoHideMs: 3000 });
  return true;
}

// 拖放打开文件（FR-12.1）：WebView 拦截系统拖放，必须订阅 Tauri 原生事件才能拿到绝对路径。
async function initDragDrop() {
  const overlay = document.createElement("div");
  overlay.id = "drop-overlay";
  overlay.textContent = i18n.t("drop.overlay");
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
  // 纯文本：TXT 插件贡献的 字体/字号 工具栏（txt 插件停用时降级为禁用的默认工具栏）
  const isPlain = tab && tab.lang === "plaintext";
  document.getElementById("toolbar-markdown").hidden = !isMd;
  document.getElementById("toolbar-plaintext").hidden = !isPlain;
  document.getElementById("toolbar-default").hidden = isMd || isPlain;
  // 字体/字号 select 在 HTML 里初始带 hidden，必须随容器同步显隐，否则永久不可见
  const fam = document.getElementById("tl-font-family");
  const sizeSel = document.getElementById("tl-font-size");
  if (fam) fam.hidden = !isPlain;
  if (sizeSel) sizeSel.hidden = !isPlain;
  // 纯文本语言：默认工具栏按钮可用（插入 Markdown 语法，与新版记事本一致）
  const plain = tab && tab.lang === "plaintext";
  document.querySelectorAll("#toolbar-default .tl-btn").forEach((btn) => {
    btn.disabled = !plain;
  });
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
    else if (ctrl && key === "p") { e.preventDefault(); printDocument(); }
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
  setWrap(!isWrapOn());
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
      text: getDocText(),
      indent: state.settings.format_indent ?? 4,
    });
    replaceDoc(out);
  } catch (e) {
    const { showDialog } = await import("./ui.js");
    const label = f.label || id;
    showDialog({ title: `${label}失败`, body: String(e) });
  }
}

// CM6 更新回调：同步标签状态、脏标记、状态栏与会话（FR-8/FR-10）
function handleCmUpdate(u) {
  const tab = activeTab();
  if (!tab) return;
  if (u.docChanged) {
    tab.text = u.state.doc.toString();
    if (!tab.dirty) {
      tab.dirty = true;
      window.dispatchEvent(new CustomEvent("tabs-refresh"));
    }
    document.title = `${tab.title}${tab.dirty ? " *" : ""} - HiEditor`;
    scheduleSessionSave();
  }
  if (u.selectionSet || u.docChanged) updateStatus();
}

function persistSettings() {
  invoke("save_settings", { value: state.settings }).catch(() => {});
}

function initFontControls() {
  const fam = document.getElementById("tl-font-family");
  const fonts = [
    ["", "默认字体"],
    ["Cascadia Mono", "Cascadia Mono"],
    ["Consolas", "Consolas"],
    ["Courier New", "Courier New"],
    ["SimSun", "宋体 SimSun"],
    ["Microsoft YaHei", "微软雅黑"],
    ["Arial", "Arial"],
  ];
  for (const [v, label] of fonts) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = label;
    fam.appendChild(opt);
  }
  fam.value = state.settings.editor_font_family || "";
  fam.addEventListener("change", () => {
    state.settings.editor_font_family = fam.value;
    persistSettings();
    applyEditorFont();
  });

  const sizeSel = document.getElementById("tl-font-size");
  for (const n of [10, 11, 12, 14, 16, 18, 20, 24, 28, 36]) {
    const opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = `${n} px`;
    sizeSel.appendChild(opt);
  }
  sizeSel.value = String(state.settings.font_size || 15);
  sizeSel.addEventListener("change", () => {
    state.settings.font_size = Number(sizeSel.value) || 15;
    persistSettings();
    document.documentElement.style.setProperty(
      "--editor-font-size",
      `${state.settings.font_size}px`
    );
  });
}

function applyEditorFont() {
  const fam = state.settings.editor_font_family;
  if (fam) {
    document.documentElement.style.setProperty("--editor-font-family", `"${fam}"`);
  } else {
    document.documentElement.style.removeProperty("--editor-font-family");
  }
}

function bindEditorEvents() {
  // 打开文件后刷新
  window.addEventListener("tab-updated", switchToolbar);
}

boot();
