// B 区菜单（第 6 章菜单树全量）：文件 / 编辑 / 查看，禁用条件实时计算

import { state, activeTab, formattersFor } from "./state.js";
import { openMenu, showDialog, showBanner } from "./ui.js";
import { editorEl, setHeading, replaceSelection } from "./editor.js";
import {
  openFile, newTab, saveActive, saveActiveAs, saveAll, closeTab, printDocument,
} from "./files.js";

function recentList() {
  return JSON.parse(localStorage.getItem("hi-recents") || "[]");
}

function fileItems() {
  return [
    { label: "新建标签页", shortcut: "Ctrl+N", action: newTab },
    { label: "新建窗口", shortcut: "Ctrl+Shift+N", disabled: true }, // M2（FR-11 多窗口）
    { sep: true },
    { label: "打开…", shortcut: "Ctrl+O", action: openFile },
    {
      label: "打开最近所用文件",
      disabled: recentList().length === 0,
      submenu: [
        ...recentList().map((p) => ({
          label: p,
          action: async () => {
            const { openPath } = await import("./files.js");
            openPath(p).catch((e) =>
              showDialog({ title: "打开失败", body: String(e) })
            );
          },
        })),
        { sep: true },
        {
          label: "清除列表",
          action: () => localStorage.setItem("hi-recents", "[]"),
        },
      ],
    },
    { sep: true },
    { label: "保存", shortcut: "Ctrl+S", action: saveActive },
    { label: "另存为…", shortcut: "Ctrl+Shift+S", action: saveActiveAs },
    { label: "全部保存", shortcut: "Ctrl+Alt+S", action: saveAll, disabled: !state.tabs.some((t) => t.dirty || !t.path) },
    { sep: true },
    { label: "打印…", shortcut: "Ctrl+P", action: printDocument },
    { sep: true },
    { label: "关闭标签页", shortcut: "Ctrl+W", action: () => activeTab() && closeTab(activeTab().id) },
    { label: "关闭窗口", shortcut: "Ctrl+Shift+W", action: () => window.__TAURI__.window.getCurrentWindow().close() },
    { label: "退出", shortcut: "Alt+F4", action: () => window.__TAURI__.window.getCurrentWindow().close() },
  ];
}

function cutCopyPaste(kind) {
  const ed = editorEl();
  ed.focus();
  const ok = document.execCommand(kind);
  if (!ok && kind === "paste") {
    showBanner({ message: "请在编辑区内使用 Ctrl+V 粘贴。", info: true, autoHideMs: 2000 });
  }
}

function timeDate() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  replaceSelection("", "", `${hh}:${mm} ${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`);
}

async function runFormatter(f) {
  const tab = activeTab();
  if (!tab) return;
  const { editorEl: ed } = await import("./editor.js");
  const text = ed().value;
  try {
    const out = await window.__TAURI__.core.invoke("format_text", {
      formatterId: f.id,
      text,
      indent: state.settings.format_indent ?? 4,
    });
    ed().value = out;
    tab.text = out;
    tab.dirty = true;
    ed().dispatchEvent(new Event("input"));
  } catch (e) {
    showDialog({ title: `${f.label}失败`, body: String(e) });
  }
}

function editItems() {
  const tab = activeTab();
  const ed = editorEl();
  const hasSel = tab && ed.selectionStart !== ed.selectionEnd;
  const fmts = tab ? formattersFor(tab.lang) : [];
  return [
    { label: "撤销", shortcut: "Ctrl+Z", action: () => { editorEl().focus(); document.execCommand("undo"); } },
    { label: "重做", shortcut: "Ctrl+Y", action: () => { editorEl().focus(); document.execCommand("redo"); } },
    { sep: true },
    { label: "剪切", shortcut: "Ctrl+X", disabled: !hasSel, action: () => cutCopyPaste("cut") },
    { label: "复制", shortcut: "Ctrl+C", disabled: !hasSel, action: () => cutCopyPaste("copy") },
    { label: "粘贴", shortcut: "Ctrl+V", action: () => cutCopyPaste("paste") },
    { label: "删除", shortcut: "Del", disabled: !hasSel, action: () => { editorEl().setRangeText("", editorEl().selectionStart, editorEl().selectionEnd, "end"); } },
    { sep: true },
    { label: "查找", shortcut: "Ctrl+F", disabled: true }, // M1（FR-4）
    { label: "查找下一个", shortcut: "F3", disabled: true },
    { label: "查找上一个", shortcut: "Shift+F3", disabled: true },
    { label: "替换", shortcut: "Ctrl+H", disabled: true },
    { label: "转到…", shortcut: "Ctrl+G", disabled: true },
    { sep: true },
    { label: "全选", shortcut: "Ctrl+A", action: () => { editorEl().focus(); editorEl().select(); } },
    { label: "时间/日期", shortcut: "F5", action: timeDate },
    ...(fmts.length
      ? [
          { sep: true },
          ...fmts.map((f) => ({
            label: f.label,
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
      label: "缩放",
      submenu: [
        { label: "放大", shortcut: "Ctrl+加号", action: () => window.dispatchEvent(new CustomEvent("zoom", { detail: 10 })) },
        { label: "缩小", shortcut: "Ctrl+减号", action: () => window.dispatchEvent(new CustomEvent("zoom", { detail: -10 })) },
        { label: "恢复默认缩放", shortcut: "Ctrl+0", action: () => window.dispatchEvent(new CustomEvent("zoom", { detail: 0 })) },
      ],
    },
    { sep: true },
    {
      label: "自动换行",
      shortcut: "Alt+Z",
      checked: document.getElementById("editor").classList.contains("wrap"),
      action: () => window.dispatchEvent(new CustomEvent("toggle-wrap")),
    },
    {
      label: "编辑模式",
      disabled: !isMd,
      submenu: [
        { label: "所见即所得", checked: isMd && tab.mode === "wysiwyg", disabled: !isMd, action: () => showWysiwygPending() },
        { label: "源码", checked: !isMd || tab.mode === "source", disabled: !isMd, action: () => switchMdMode("source") },
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
