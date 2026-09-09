// 总装：启动加载注册表/设置 → 初始标签 → 全局快捷键 → 窗口控制

import { state, activeTab, newTabModel, langForPath } from "./state.js";
import { initTitlebar, syncCaptionGlyph } from "./titlebar.js";
import { initMenus, initEditorContextMenu } from "./menus.js";
import { initToolbars, updateToolbarOverflow } from "./toolbar.js";
import { initStatusbar } from "./statusbar.js";
import { openSettings, closeSettings } from "./settings.js";
import { initMarkdownPreview, applyMarkdownMode } from "./mdpreview.js";
import { syncTabBanner } from "./ui.js";
import { newTab, switchTab, openPath, openFile, saveActive, saveActiveAs, saveAll, closeTab, printDocument } from "./files.js";
import { setZoom, setWrap, isWrapOn, updateStatus, editorHostEl, getDocText, replaceDoc, setEditorDark, initEditorInstance, openFind, openReplace } from "./editor.js";
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
  initMarkdownPreview();

  state.registry = await invoke("get_registry");
  state.settings = await invoke("get_settings");
  i18n.setLanguage(state.settings.language || "auto");
  i18n.applyI18n();
  applyTabFont(); // 默认字体/字号来自全局设置（每个标签可单独覆盖，FR per-tab）
  applyTheme(state.settings.theme || "light");
  setEditorDark((state.settings.theme || "light") === "dark");

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

  // 右键“用 HiEditor 编辑”冷启动入口：打开命令行携带的文件（FR-2.10）
  try {
    const launchFile = await invoke("take_launch_file");
    if (launchFile) await openPath(launchFile);
  } catch (e) { /* 无启动参数 */ }

  // 第二实例转发：已运行时右键打开文件 → 主实例内打开该文件
  try {
    if (window.__TAURI__.event) {
      window.__TAURI__.event.listen("open-file-request", async (e) => {
        if (e.payload) await openPath(e.payload);
      });
    }
  } catch (err) { /* 事件 API 不可用时忽略 */ }

  // 右键菜单自愈：已启用时随启动静默刷新注册表中的 exe 路径与菜单文案
  try {
    if (await invoke("explorer_context_menu_enabled")) {
      await invoke("set_explorer_context_menu", { enable: true });
    }
  } catch (err) { /* 非 Windows 平台 */ }

  initFontControls();
  bindGlobalKeys();
  bindEditorEvents();
  switchToolbar(); // 补一次同步：修复恢复/首建标签时工具栏状态未刷新
  applyMarkdownMode();
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
        if (t) {
          t.zoom = st.zoom || 100;
          t.fontFamily = st.fontFamily || null;
          t.fontSize = st.fontSize || null;
          restoredCount++;
        }
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
        fontFamily: st.fontFamily || null,
        fontSize: st.fontSize || null,
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
  // 自定义工具栏由插件 config.json 的 toolbar 声明驱动：语言 → 工具栏 id（附录 C）。
  // 容器约定：id = "toolbar-" + toolbar.id（如 toolbar-markdown-wysiwyg）
  const binding = tab && (state.registry.toolbars || []).find((b) => b.language === tab.lang);
  const custom = binding ? document.getElementById(`toolbar-${binding.toolbar}`) : null;
  document.querySelectorAll(".toolbar-wrap .toolbar").forEach((el) => {
    if (el.id === "toolbar-font") return; // 默认栏最后统一处理
    el.hidden = el !== custom;
  });
  // 默认工具栏：仅 字体/字号（适用于未声明自定义工具栏的所有语言）
  document.getElementById("toolbar-font").hidden = !!custom;
  syncFontControls();
  applyTabFont();
  updateToolbarOverflow(); // 容器切换后重测溢出收纳
}

function bindGlobalKeys() {
  window.addEventListener("keydown", (e) => {
    if (state.settingsOpen) return; // 设置模态框打开期间阻塞全局快捷键（Esc 关闭由 settings.js 处理）
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && !e.shiftKey && key === "n") { e.preventDefault(); newTab(); }
    else if (ctrl && !e.shiftKey && key === "t") { e.preventDefault(); newTab(); }
    else if (ctrl && !e.shiftKey && key === "o") { e.preventDefault(); openFile(); }
    else if (ctrl && !e.shiftKey && key === "s") { e.preventDefault(); saveActive(); }
    else if (ctrl && e.shiftKey && key === "s") { e.preventDefault(); saveActiveAs(); }
    else if (ctrl && e.altKey && key === "s") { e.preventDefault(); saveAll(); }
    else if (ctrl && key === "p") { e.preventDefault(); printDocument(); }
    else if (ctrl && !e.shiftKey && key === "f") { e.preventDefault(); openFind(); } // 搜索菜单（FR-4）
    else if (ctrl && !e.shiftKey && key === "h") { e.preventDefault(); openReplace(); }
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
    if (state.settingsOpen) return; // 模态打开时缩放快捷滚轮不作用于遮罩下的编辑器
    if (e.ctrlKey) {
      e.preventDefault();
      zoom(e.deltaY < 0 ? 5 : -5);
    }
  }, { passive: false });

  window.addEventListener("zoom", (e) => zoom(e.detail));
  window.addEventListener("toggle-wrap", toggleWrap);
  window.addEventListener("request-save", saveActive);
  const syncTabUi = () => { switchToolbar(); syncTabBanner(); applyMarkdownMode(); }; // 切标签：工具栏 + 标签横幅 + md 预览一并同步
  window.addEventListener("tab-switched", syncTabUi);
  window.addEventListener("tabs-refresh", syncTabUi);
  window.addEventListener("settings-changed", switchToolbar);
  // 设置页改全局默认字号 → 未单独设置字号的标签立即生效（applyTabFont 回退默认值）
  window.addEventListener("settings-changed", switchToolbar);
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
  // 字体 per-tab：只改当前标签（tab.fontFamily=null 表示跟随全局默认）
  fam.addEventListener("change", () => {
    const tab = activeTab();
    if (!tab) return;
    tab.fontFamily = fam.value || null;
    applyTabFont();
    scheduleSessionSave();
  });

  const sizeSel = document.getElementById("tl-font-size");
  for (const n of [10, 11, 12, 14, 15, 16, 18, 20, 24, 28, 36]) {
    const opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = `${n} px`;
    sizeSel.appendChild(opt);
  }
  // 字号 per-tab：只改当前标签（tab.fontSize=null 表示跟随全局默认）
  sizeSel.addEventListener("change", () => {
    const tab = activeTab();
    if (!tab) return;
    tab.fontSize = Number(sizeSel.value) || null;
    applyTabFont();
    scheduleSessionSave();
  });
  syncFontControls();
}

// 把字体/字号下拉框同步为当前标签的值（切标签时调用）
function syncFontControls() {
  const tab = activeTab();
  if (!tab) return;
  document.getElementById("tl-font-family").value = tab.fontFamily || "";
  document.getElementById("tl-font-size").value = String(
    tab.fontSize || state.settings.font_size || 15
  );
}

// 应用当前标签的字体/字号（per-tab：仅对当前编辑的选项卡生效）。
// 标签未单独设置时回退全局设置默认值；编辑器单实例，切换标签时重算 CSS 变量即可。
function applyTabFont() {
  const tab = activeTab();
  const fam = (tab && tab.fontFamily) || "";
  const size = (tab && tab.fontSize) || state.settings.font_size || 15;
  if (fam) {
    document.documentElement.style.setProperty("--editor-font-family", `"${fam}"`);
  } else {
    document.documentElement.style.removeProperty("--editor-font-family");
  }
  document.documentElement.style.setProperty("--editor-font-size", `${size}px`);
}

function bindEditorEvents() {
  // 打开文件后刷新
  window.addEventListener("tab-updated", switchToolbar);
}

boot();
