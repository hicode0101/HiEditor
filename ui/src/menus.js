// B 区菜单（第 6 章菜单树全量）：文件 / 编辑 / 查看，禁用条件实时计算

import { state, activeTab, formattersFor } from "./state.js";
import { t } from "./i18n.js";
import { openMenu, showDialog, showBanner } from "./ui.js";
import {
  focusEditor, getSelectionRange, replaceSelection, setHeading, isWrapOn,
  editorUndo, editorRedo, cutSelection, copySelection, pasteFromClipboard,
  deleteSelection, selectAll,
} from "./editor.js";
import {
  openFile, newTab, saveActive, saveActiveAs, saveAll, closeTab, printDocument,
} from "./files.js";

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
    { label: t("edit.cut"), shortcut: "Ctrl+X", disabled: !hasSel, action: cutSelection },
    { label: t("edit.copy"), shortcut: "Ctrl+C", disabled: !hasSel, action: copySelection },
    { label: t("edit.paste"), shortcut: "Ctrl+V", action: pasteFromClipboard },
    { label: t("edit.delete"), shortcut: "Del", disabled: !hasSel, action: deleteSelection },
    { sep: true },
    { label: t("edit.find"), shortcut: "Ctrl+F", disabled: true }, // M1（FR-4）
    { label: t("edit.findNext"), shortcut: "F3", disabled: true },
    { label: t("edit.findPrev"), shortcut: "Shift+F3", disabled: true },
    { label: t("edit.replace"), shortcut: "Ctrl+H", disabled: true },
    { label: t("edit.goto"), shortcut: "Ctrl+G", disabled: true },
    { sep: true },
    { label: t("edit.selectAll"), shortcut: "Ctrl+A", action: selectAll },
    { label: t("edit.timeDate"), shortcut: "F5", action: timeDate },
    ...(fmts.length
      ? [
          { sep: true },
          ...fmts.map((f) => ({
            label: t(`fmt.${f.id}`) !== `fmt.${f.id}` ? t(`fmt.${f.id}`) : f.label,
            shortcut: f.shortcut || undefined,
            action: () => runFormatter(f),
          })),
        ]
      : []),
  ];
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
  showBanner({
    message: "所见即所得引擎将在后续里程碑接入，当前以源码模式显示 Markdown。",
    info: true,
    autoHideMs: 3000,
  });
}

function switchMdMode(mode) {
  const tab = activeTab();
  if (tab) tab.mode = mode;
}

export function initMenus() {
  const defs = {
    file: fileItems,
    edit: editItems,
    view: viewItems,
  };
  document.querySelectorAll(".menu-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      openMenu(btn, defs[btn.dataset.menu]());
    });
  });
}

// ===== 编辑区右键菜单（FR-15.1）：格式化项按当前语言自动启用/禁用 =====

export function initEditorContextMenu() {
  const host = document.getElementById("editor");
  host.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const tab = activeTab();
    const { from, to } = getSelectionRange();
    const hasSel = tab && from !== to;
    const fmts = tab ? formattersFor(tab.lang) : [];
    const items = [
      { label: t("edit.cut"), shortcut: "Ctrl+X", disabled: !hasSel, action: cutSelection },
      { label: t("edit.copy"), shortcut: "Ctrl+C", disabled: !hasSel, action: copySelection },
      { label: t("edit.paste"), shortcut: "Ctrl+V", action: pasteFromClipboard },
      { sep: true },
      { label: t("edit.selectAll"), shortcut: "Ctrl+A", action: selectAll },
      { sep: true },
      {
        label: t("edit.format"),
        disabled: fmts.length === 0,
        submenu: fmts.map((f) => ({
          label: f.label,
          shortcut: f.shortcut || undefined,
          action: () => runFormatter(f),
        })),
      },
    ];
    openMenu(host, items, { x: e.clientX, y: e.clientY });
  });
}
