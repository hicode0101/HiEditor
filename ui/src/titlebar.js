// A 区：标题栏 / 标签条（UI-1）：新建、切换、关闭、脏标记圆点、拖拽重排、窗口控制

import { state, activeTab } from "./state.js";
import { ICONS, setIcon } from "./icons.js";
import { openMenu, closeFlyout, bindTooltip } from "./ui.js";
import { newTab, switchTab, closeTab, saveTab } from "./files.js";

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
  return tab.title || "无标题";
}

function tabTooltip(tab) {
  if (!tab.path) return `${tabTitle(tab)}（未保存）`;
  return tab.dirty ? `${tab.path}（有未保存更改）` : tab.path;
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
}

function buildTabContent(el, tab) {
  if (tab.dirty && tab.id !== state.activeId) {
    const dot = document.createElement("span");
    dot.className = "dirty-dot dot-hidden";
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
  el.addEventListener("click", () => switchTab(tab.id));
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
  // 拖拽重排（UI-1.9）
  el.draggable = true;
  el.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("hi-tab", String(tab.id));
    e.dataTransfer.effectAllowed = "move";
  });
  el.addEventListener("dragover", (e) => e.preventDefault());
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    const dragged = Number(e.dataTransfer.getData("hi-tab"));
    if (!dragged || dragged === tab.id) return;
    const from = state.tabs.findIndex((t) => t.id === dragged);
    const to = state.tabs.findIndex((t) => t.id === tab.id);
    if (from < 0 || to < 0) return;
    const [moved] = state.tabs.splice(from, 1);
    state.tabs.splice(to, 0, moved);
    window.dispatchEvent(new CustomEvent("tabs-refresh"));
  });
}

// 标签右键菜单项（作用于被右键的标签，FR-1.5）
function tabMenuItems(tabId) {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return [];
  const others = state.tabs.filter((t) => t.id !== tabId);
  return [
    { label: "关闭选项卡", action: () => closeTab(tabId) },
    {
      label: "关闭其它选项卡",
      disabled: others.length === 0,
      action: async () => {
        for (const t of [...others]) await closeTab(t.id);
      },
    },
    { sep: true },
    {
      label: "保存",
      disabled: !tab.dirty && !!tab.path,
      action: () => saveTab(tab),
    },
    { label: "另存为", action: () => saveTab(tab, { as: true }) },
  ];
}

export function syncCaptionGlyph() {
  window.__TAURI__.window
    .getCurrentWindow()
    .isMaximized()
    .then((maxed) =>
      setIcon(document.getElementById("cap-max"), maxed ? "restore" : "maximize")
    );
}
