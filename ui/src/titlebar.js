// A 区：标题栏 / 标签条（UI-1）：新建、切换、关闭、脏标记圆点、拖拽重排、窗口控制

import { state, activeTab } from "./state.js";
import { ICONS, setIcon } from "./icons.js";
import { openMenu, closeFlyout, bindTooltip } from "./ui.js";
import { t } from "./i18n.js";
import { newTab, switchTab, closeTab, saveTab } from "./files.js";

// 标签拖拽状态（指针式实现：Tauri 原生文件拖放拦截会禁用 HTML5 dnd，故用 mousedown/mousemove 手动换位）
let dragCtx = null; // { tabId, startX, startY, moved }
let justDraggedId = null; // 拖拽结束后的 click 抑制标记

export function initTitlebar() {
  const appIcon = document.querySelector(".app-icon");
  appIcon.innerHTML = ICONS.app;
  setIcon(document.getElementById("btn-new-tab"), "plus");
  setIcon(document.getElementById("cap-min"), "minimize");
  setIcon(document.getElementById("cap-max"), "maximize");
  setIcon(document.getElementById("cap-close"), "closeSm");

  document.getElementById("btn-new-tab").addEventListener("click", newTab);
  document.getElementById("cap-min").addEventListener("click", () =>
    window.__TAURI__.window.getCurrentWindow().minimize()
  );
  document.getElementById("cap-max").addEventListener("click", toggleMaximize);
  document.getElementById("cap-close").addEventListener("click", () =>
    window.__TAURI__.window.getCurrentWindow().close()
  );

  const tabs = document.getElementById("tabs");
  tabs.addEventListener("wheel", (e) => {
    tabs.scrollLeft += e.deltaY;
  });
  tabs.addEventListener("dblclick", (e) => {
    if (e.target === tabs) newTab();
  });

  window.addEventListener("tabs-refresh", renderTabs);
  window.addEventListener("tab-updated", renderTabs);
  window.addEventListener("tab-switched", renderTabs);

  // 拖拽中的全局跟踪（document 级：标签重渲染不影响监听）
  document.addEventListener("mousemove", (e) => {
    if (!dragCtx) return;
    if (!dragCtx.moved) {
      if (Math.hypot(e.clientX - dragCtx.startX, e.clientY - dragCtx.startY) < 5) return;
      dragCtx.moved = true;
      document.querySelector(`.tab[data-id="${dragCtx.tabId}"]`)?.classList.add("dragging");
      closeFlyout();
    }
    // 命中光标下的标签并实时换位
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest(".tab");
    if (!over) return;
    const overId = Number(over.dataset.id);
    if (!overId || overId === dragCtx.tabId) return;
    const from = state.tabs.findIndex((t) => t.id === dragCtx.tabId);
    const to = state.tabs.findIndex((t) => t.id === overId);
    if (from < 0 || to < 0) return;
    const [moved] = state.tabs.splice(from, 1);
    state.tabs.splice(to, 0, moved);
    window.dispatchEvent(new CustomEvent("tabs-refresh"));
  });
  document.addEventListener("mouseup", () => {
    if (!dragCtx) return;
    if (dragCtx.moved) {
      justDraggedId = dragCtx.tabId; // 抑制 mouseup 附带的 click 误切换
      setTimeout(() => { justDraggedId = null; }, 0);
      window.dispatchEvent(new CustomEvent("tabs-refresh"));
    }
    dragCtx = null;
  });
}

async function toggleMaximize() {
  const win = window.__TAURI__.window.getCurrentWindow();
  await win.toggleMaximize();
  const maxed = await win.isMaximized();
  setIcon(
    document.getElementById("cap-max"),
    maxed ? "restore" : "maximize"
  );
}

function tabTitle(tab) {
  return tab.title || t("tab.untitled");
}

function tabTooltip(tab) {
  if (!tab.path) return t("tab.tooltipUnsaved", { name: tabTitle(tab) });
  return tab.dirty ? t("tab.tooltipDirty", { path: tab.path }) : tab.path;
}

function renderTabs() {
  const container = document.getElementById("tabs");
  container.innerHTML = "";
  for (const tab of state.tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (tab.id === state.activeId ? " active" : "");
    el.dataset.id = tab.id;
    buildTabContent(el, tab);
    container.appendChild(el);
  }
  if (dragCtx && dragCtx.moved) {
    document.querySelector(`.tab[data-id="${dragCtx.tabId}"]`)?.classList.add("dragging");
  }
}

function buildTabContent(el, tab) {
  // 脏标记圆点：只要内容有未保存修改就显示，无论是否为激活标签（v1.7）
  if (tab.dirty) {
    const dot = document.createElement("span");
    dot.className = "dirty-dot";
    el.appendChild(dot);
  }
  const title = document.createElement("span");
  title.className = "tab-title";
  title.textContent = tabTitle(tab);
  el.appendChild(title);
  const close = document.createElement("button");
  close.className = "tab-close";
  close.innerHTML = ICONS.closeSm;
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    closeTab(tab.id);
  });
  el.appendChild(close);
  el.addEventListener("click", () => {
    if (justDraggedId === tab.id) return; // 拖拽结束后的 mouseup 会附带 click，抑制误切换
    switchTab(tab.id);
  });
  // 标签右键菜单（FR-1.5 v1.5：关闭选项卡 / 关闭其它选项卡 / 保存 / 另存为）
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!state.tabs.some((t) => t.id === tab.id)) return;
    openMenu(el, tabMenuItems(tab.id), { x: e.clientX, y: e.clientY });
  });
  el.addEventListener("mousedown", (e) => {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(tab.id);
    }
  });
  bindTooltip(el, () => tabTooltip(tab));
  // 拖拽重排（UI-1.9 v1.7 指针式）：按下 → 移动超过 5px 进入拖拽 → 悬停换位 → 松开落定
  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.target.closest(".tab-close")) return;
    dragCtx = { tabId: tab.id, startX: e.clientX, startY: e.clientY, moved: false };
  });
}

// 标签右键菜单项（作用于被右键的标签，FR-1.5 / v1.7 追加文件位置操作）
function tabMenuItems(tabId) {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return [];
  const others = state.tabs.filter((t) => t.id !== tabId);
  return [
    { label: t("tab.menu.close"), action: () => closeTab(tabId) },
    {
      label: t("tab.menu.closeOthers"),
      disabled: others.length === 0,
      action: async () => {
        for (const t of [...others]) await closeTab(t.id);
      },
    },
    { sep: true },
    {
      label: t("tab.menu.save"),
      disabled: !tab.dirty && !!tab.path,
      action: () => saveTab(tab),
    },
    { label: t("tab.menu.saveAs"), action: () => saveTab(tab, { as: true }) },
    // 文件位置操作（未保存到磁盘的标签不可用）
    { sep: true },
    { label: t("tab.menu.openFolder"), disabled: !tab.path, action: () => revealInFileManager(tab.path) },
    { label: t("tab.menu.copyDir"), disabled: !tab.path, action: () => copyTextToClipboard(dirName(tab.path)) },
    { label: t("tab.menu.copyPath"), disabled: !tab.path, action: () => copyTextToClipboard(tab.path) },
  ];
}

function dirName(path) {
  // 基于原始路径切片：保持与完整路径一致的分隔符风格（Windows 反斜杠）
  const i = Math.max(String(path).lastIndexOf("\\"), String(path).lastIndexOf("/"));
  return i > 0 ? String(path).slice(0, i) : String(path);
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // 剪贴板 API 被拒时的兜底：隐藏 textarea + execCommand
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  const { showBanner } = await import("./ui.js");
  showBanner({ message: t("banner.copied"), info: true, autoHideMs: 1500 });
}

async function revealInFileManager(path) {
  try {
    await window.__TAURI__.core.invoke("reveal_path", { path });
  } catch (e) {
    const { showDialog } = await import("./ui.js");
    showDialog({ title: t("dialog.openError"), body: String(e) });
  }
}

export function syncCaptionGlyph() {
  window.__TAURI__.window
    .getCurrentWindow()
    .isMaximized()
    .then((maxed) =>
      setIcon(document.getElementById("cap-max"), maxed ? "restore" : "maximize")
    );
}
