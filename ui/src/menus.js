// B 区菜单（第 6 章菜单树全量）：文件 / 编辑 / 查看，禁用条件实时计算

import { state, activeTab, formattersFor } from "./state.js";
import { t } from "./i18n.js";
import { openMenu, closeFlyout, showDialog, showBanner } from "./ui.js";
import {
  focusEditor, getSelectionRange, replaceSelection, setHeading, isWrapOn,
  editorUndo, editorRedo, cutSelection, copySelection, pasteFromClipboard,
  deleteSelection, selectAll, transformUpper, transformLower, transformCapitalize,
  openFind, openReplace,
} from "./editor.js";
import {
  openFile, newTab, saveActive, saveActiveAs, saveAll, closeTab, printDocument,
} from "./files.js";
import { openSettings } from "./settings.js";

function recentList() {
  return JSON.parse(localStorage.getItem("hi-recents") || "[]");
}

function fileItems() {
  return [
    { label: t("file.newTab"), shortcut: "Ctrl+N", action: newTab },
    { label: t("file.newWindow"), shortcut: "Ctrl+Shift+N", disabled: true }, // M2（FR-11 多窗口）
    { sep: true },
    { label: t("file.open"), shortcut: "Ctrl+O", action: openFile },
    {
      label: t("file.openRecent"),
      disabled: recentList().length === 0,
      submenu: [
        ...recentList().map((p) => ({
          label: p,
          action: async () => {
            const { openPath } = await import("./files.js");
            openPath(p).catch((e) =>
              showDialog({ title: t("dialog.openError"), body: String(e) })
            );
          },
        })),
        { sep: true },
        {
          label: t("file.clearRecent"),
          action: () => localStorage.setItem("hi-recents", "[]"),
        },
      ],
    },
    { sep: true },
    { label: t("file.save"), shortcut: "Ctrl+S", action: saveActive },
    { label: t("file.saveAs"), shortcut: "Ctrl+Shift+S", action: saveActiveAs },
    { label: t("file.saveAll"), shortcut: "Ctrl+Alt+S", action: saveAll, disabled: !state.tabs.some((t) => t.dirty || !t.path) },
    { sep: true },
    { label: t("file.print"), shortcut: "Ctrl+P", action: printDocument },
    { sep: true },
    { label: t("file.closeTab"), shortcut: "Ctrl+W", action: () => activeTab() && closeTab(activeTab().id) },
    { label: t("file.closeWindow"), shortcut: "Ctrl+Shift+W", action: () => window.__TAURI__.window.getCurrentWindow().close() },
    { sep: true },
    { label: t("file.settings"), action: openSettings }, // 倒数第二：设置（FR-2 设置入口）
    { label: t("file.exit"), shortcut: "Alt+F4", action: () => window.__TAURI__.window.getCurrentWindow().close() },
  ];
}

async function runFormatter(f) {
  const tab = activeTab();
  if (!tab) return;
  const { getDocText, replaceDoc } = await import("./editor.js");
  try {
    const out = await window.__TAURI__.core.invoke("format_text", {
      formatterId: f.id,
      text: getDocText(),
      indent: state.settings.format_indent ?? 4,
    });
    replaceDoc(out);
  } catch (e) {
    showDialog({ title: `${f.label}失败`, body: String(e) });
  }
}

function editItems() {
  const tab = activeTab();
  const { from, to } = getSelectionRange();
  const hasSel = tab && from !== to;
  const fmts = tab ? formattersFor(tab.lang) : [];
  return [
    { label: t("edit.undo"), shortcut: "Ctrl+Z", action: editorUndo },
    { label: t("edit.redo"), shortcut: "Ctrl+Y", action: editorRedo },
    { sep: true },
    { label: t("edit.selectAll"), shortcut: "Ctrl+A", action: selectAll },
    { label: t("edit.cut"), shortcut: "Ctrl+X", disabled: !hasSel, action: cutSelection },
    { label: t("edit.copy"), shortcut: "Ctrl+C", disabled: !hasSel, action: copySelection },
    { label: t("edit.paste"), shortcut: "Ctrl+V", action: pasteFromClipboard },
    { label: t("edit.delete"), shortcut: "Del", disabled: !hasSel, action: deleteSelection },
    { sep: true },
    { label: t("edit.upper"), disabled: !hasSel, action: transformUpper },
    { label: t("edit.lower"), disabled: !hasSel, action: transformLower },
    { label: t("edit.capitalize"), disabled: !hasSel, action: transformCapitalize },
    { sep: true },
    {
      // 与编辑区右键菜单一致的"格式化"子菜单（FR-16.8）：无可用格式化时整项禁用
      label: t("edit.format"),
      disabled: fmts.length === 0,
      submenu: fmts.map((f) => ({
        label: t(`fmt.${f.id}`) !== `fmt.${f.id}` ? t(`fmt.${f.id}`) : f.label,
        shortcut: f.shortcut || undefined,
        action: () => runFormatter(f),
      })),
    },
  ];
}

// 搜索菜单（FR-4）：查找 / 替换（CM6 内置面板）
function searchItems() {
  return [
    { label: t("edit.find"), shortcut: "Ctrl+F", action: openFind },
    { label: t("edit.replace"), shortcut: "Ctrl+H", action: openReplace },
  ];
}

// 时间/日期插入（F5 同款）：修复此前 editItems 引用未定义函数导致编辑菜单整个打不开的 bug
function timeDate() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  replaceSelection("", "", `${hh}:${mm} ${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`);
}

function viewItems() {
  const tab = activeTab();
  const isMd = tab && tab.lang === "markdown";
  return [
    {
      label: t("view.zoomGroup"),
      submenu: [
        { label: t("view.zoomIn"), shortcut: "Ctrl+加号", action: () => window.dispatchEvent(new CustomEvent("zoom", { detail: 10 })) },
        { label: t("view.zoomOut"), shortcut: "Ctrl+减号", action: () => window.dispatchEvent(new CustomEvent("zoom", { detail: -10 })) },
        { label: t("view.zoomReset"), shortcut: "Ctrl+0", action: () => window.dispatchEvent(new CustomEvent("zoom", { detail: 0 })) },
      ],
    },
    { sep: true },
    {
      label: t("view.wordWrap"),
      shortcut: "Alt+Z",
      checked: isWrapOn(),
      action: () => window.dispatchEvent(new CustomEvent("toggle-wrap")),
    },
    {
      label: t("view.editModeGroup"),
      disabled: !isMd,
      submenu: [
        { label: t("view.wysiwyg"), checked: isMd && tab.mode === "wysiwyg", disabled: !isMd, action: () => showWysiwygPending() },
        { label: t("view.source"), checked: !isMd || tab.mode === "source", disabled: !isMd, action: () => switchMdMode("source") },
      ],
    },
  ];
}

function showWysiwygPending() {
  showBanner({ message: t("banner.wysiwygPending"), info: true, autoHideMs: 3000 });
}

function switchMdMode(mode) {
  const tab = activeTab();
  if (tab) tab.mode = mode;
}

export function initMenus() {
  const defs = {
    file: fileItems,
    edit: editItems,
    search: searchItems,
    view: viewItems,
  };
  document.querySelectorAll(".menu-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      openMenu(btn, defs[btn.dataset.menu]());
    });
  });
}

// ===== 编辑区右键菜单（FR-15.1，v1.7 与顶部"编辑"菜单同构）：格式化项按当前语言自动启用/禁用 =====

export function initEditorContextMenu() {
  const host = document.getElementById("editor");
  host.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    // 一次性游离锚点：避开 openMenu 的"同一锚点再点=收起"语义——
    // 否则第二次右键（锚点同为 #editor）只会关闭旧菜单而不会在新坐标重开
    openMenu(document.createElement("span"), editItems(), { x: e.clientX, y: e.clientY });
  });
  // 左键点击编辑区：关闭仍打开的右键/下拉菜单（全局关闭器把 #editor 内的点击
  // 视为"点在锚点上"而跳过关闭，这里显式补一刀）
  host.addEventListener("mousedown", (e) => {
    if (e.button === 0) closeFlyout();
  });
}
