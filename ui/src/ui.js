// 浮层组件：下拉菜单（UI-5.1）、错误对话框（UI-5.4 风格）、tooltip（UI-1.7 样式）

import { state, activeTab } from "./state.js";

const layer = () => document.getElementById("overlay-layer");

let openFlyout = null;
let openAnchor = null;

export function closeFlyout() {
  if (openFlyout) {
    openFlyout.remove();
    openFlyout = null;
    if (openAnchor) {
      openAnchor.classList.remove("open");
      openAnchor = null;
    }
  }
}

export function isFlyoutOpen() {
  return !!openFlyout;
}

function buildItem(item) {
  if (item.sep) {
    const sep = document.createElement("div");
    sep.className = "menu-sep";
    return sep;
  }
  const btn = document.createElement("button");
  btn.className = "menu-item" + (item.checked ? " checked" : "");
  btn.disabled = item.disabled ? true : false;
  const check = document.createElement("span");
  check.className = "mi-check";
  check.textContent = "✓";
  const label = document.createElement("span");
  label.className = "mi-label";
  label.textContent = item.label;
  const shortcut = document.createElement("span");
  shortcut.className = "mi-shortcut";
  shortcut.textContent = item.shortcut || "";
  btn.append(check, label, shortcut);
  if (!item.disabled) {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeFlyout();
      item.action && item.action();
    });
  }
  return btn;
}

/**
 * 在锚点元素下打开下拉菜单。items: {label, shortcut, action, disabled(), checked(), sep, submenu:[...]}
 * opts: { align, x, y } —— 传 x/y 时按指定坐标弹出（用于右键上下文菜单）。
 */
export function openMenu(anchor, items, { align = "left", x = null, y = null } = {}) {
  const same = openAnchor === anchor;
  closeFlyout();
  if (same) return; // 再点同一锚点 = 收起

  const flyout = document.createElement("div");
  flyout.className = "menu-flyout";
  let yShift = 0;
  for (const item of items) {
    if (item.submenu) {
      // 子菜单：嵌套在父项内，点击展开（父菜单保留）
      const holder = document.createElement("div");
      holder.style.position = "relative";
      const parentBtn = document.createElement("button");
      parentBtn.className = "menu-item" + (item.disabled ? "" : "");
      if (item.disabled) parentBtn.disabled = true;
      const check = document.createElement("span");
      check.className = "mi-check"; // 与普通项同构：16px 勾选占位列，保证标签左缘对齐
      check.textContent = "✓";
      const lbl = document.createElement("span");
      lbl.className = "mi-label";
      lbl.textContent = item.label;
      const arrow = document.createElement("span");
      arrow.className = "mi-shortcut";
      arrow.textContent = "›";
      parentBtn.append(check, lbl, arrow);
      parentBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const existing = holder.querySelector(":scope > .menu-flyout");
        if (existing) { existing.remove(); return; }
        const sub = document.createElement("div");
        sub.className = "menu-flyout";
        sub.style.position = "absolute";
        sub.style.left = "calc(100% - 6px)";
        sub.style.top = "0";
        for (const child of item.submenu) sub.appendChild(buildItem(child));
        holder.appendChild(sub);
      });
      holder.appendChild(parentBtn);
      flyout.appendChild(holder);
      yShift = 0;
    } else {
      flyout.appendChild(buildItem(item));
    }
  }
  layer().appendChild(flyout);

  const rect = anchor.getBoundingClientRect();
  const fw = flyout.offsetWidth;
  let px = x === null ? (align === "right" ? rect.right - fw : rect.left) : x;
  px = Math.max(4, Math.min(px, window.innerWidth - fw - 4));
  let py = y === null ? rect.bottom + 2 : y;
  const fh = flyout.offsetHeight;
  if (py + fh > window.innerHeight - 4) py = Math.max(4, py - fh - 4);
  flyout.style.left = px + "px";
  flyout.style.top = py + "px";

  openFlyout = flyout;
  openAnchor = anchor;
  anchor.classList.add("open");
}

/**
 * 打开自定义弹层（如表格选择器），纳入统一的"点击外部 / Esc 关闭"管理。
 */
export function openPopover(anchor, el) {
  closeFlyout();
  layer().appendChild(el);
  openFlyout = el;
  openAnchor = anchor;
  anchor.classList.add("open");
}

// 点击空白处 / Esc 收起
window.addEventListener("mousedown", (e) => {
  if (openFlyout && !openFlyout.contains(e.target) && e.target !== openAnchor) {
    if (openAnchor && openAnchor.contains(e.target)) return;
    closeFlyout();
  }
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeFlyout();
    closeDialog();
  }
});

// ===== 模态对话框（保存确认 UI-5.7 / 错误 FR-16.5 / 转到行等共用骨架） =====

let dialogEl = null;

/**
 * showDialog({ title, body, buttons: [{label, primary, value}] }) -> Promise<value|null>
 */
export function showDialog({ title, body = "", buttons = [{ label: "OK", primary: true, value: true }] }) {
  closeDialog();
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    const dlg = document.createElement("div");
    dlg.className = "dialog";
    const t = document.createElement("div");
    t.className = "dlg-title";
    t.textContent = title;
    dlg.appendChild(t);
    if (body) {
      const b = document.createElement("div");
      b.className = "dlg-body";
      b.textContent = body;
      dlg.appendChild(b);
    }
    const actions = document.createElement("div");
    actions.className = "dlg-actions";
    for (const spec of buttons) {
      const btn = document.createElement("button");
      btn.className = "dlg-btn" + (spec.primary ? " primary" : "");
      btn.textContent = spec.label;
      btn.addEventListener("click", () => {
        closeDialog();
        resolve(spec.value);
      });
      actions.appendChild(btn);
    }
    dlg.appendChild(actions);
    backdrop.appendChild(dlg);
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) {
        closeDialog();
        resolve(null);
      }
    });
    layer().appendChild(backdrop);
    dialogEl = backdrop;
    const primary = actions.querySelector(".primary");
    primary && primary.focus();
  });
}

export function closeDialog() {
  if (dialogEl) {
    dialogEl.remove();
    dialogEl = null;
  }
}

// ===== 横幅（FR-14）=====
// 横幅分两类：全局操作反馈（自动消失）与文件级状态提示（归属触发它的标签，
// 切到其它标签自动隐藏、切回恢复，关闭标签即消失）。

let bannerTabId = null;

/**
 * 全局横幅（单例，与标签无关）：操作反馈类提示（自动消失）。
 */
export function showBanner(spec, tabId = null) {
  dismissBanner();
  bannerTabId = tabId;
  const banner = document.createElement("div");
  banner.className = "banner" + (spec.info ? " info" : "");
  const text = document.createElement("span");
  text.className = "bn-text";
  text.textContent = spec.message;
  banner.appendChild(text);
  for (const b of spec.buttons || []) {
    const btn = document.createElement("button");
    btn.className = "bn-btn";
    btn.textContent = b.label;
    btn.addEventListener("click", () => {
      dismissBanner();
      b.action && b.action();
    });
    banner.appendChild(btn);
  }
  const content = document.getElementById("content");
  content.insertBefore(banner, content.firstChild);
  banner.id = "active-banner";
  if (spec.autoHideMs > 0) setTimeout(dismissBanner, spec.autoHideMs);
}

/**
 * 标签横幅（标签归属）：状态提示类（如编码告警），仅在该标签激活时显示，
 * 归属信息记在 tab.banner 上随标签切换/关闭自动隐现。后续文件级提示均用此入口。
 */
export function showTabBanner(tabId, spec) {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (tab) tab.banner = spec;
  showBanner(spec, tabId);
}

export function dismissBanner() {
  document.getElementById("active-banner")?.remove();
}

// 切换标签时同步：隐藏不属于当前标签的横幅；当前标签有归属横幅则恢复显示
export function syncTabBanner() {
  const tab = activeTab();
  if (tab && tab.banner) {
    if (bannerTabId !== tab.id) showBanner({ message: tab.banner.message, info: tab.banner.info }, tab.id);
    return;
  }
  if (bannerTabId !== null) dismissBanner(); // 当前横幅属于别的标签 → 收起
  bannerTabId = null;
}

// ===== tooltip（UI-1.7） =====

const tipEl = () => document.getElementById("tooltip");
let tipTimer = null;

export function bindTooltip(el, textFn) {
  el.addEventListener("mouseenter", () => {
    tipTimer = setTimeout(() => {
      const text = typeof textFn === "function" ? textFn() : textFn;
      if (!text) return;
      const tip = tipEl();
      tip.textContent = text;
      tip.hidden = false;
      const rect = el.getBoundingClientRect();
      const tw = tip.offsetWidth;
      let x = rect.left + rect.width / 2 - tw / 2;
      x = Math.max(4, Math.min(x, window.innerWidth - tw - 4));
      tip.style.left = x + "px";
      tip.style.top = rect.bottom + 6 + "px";
    }, 400);
  });
  el.addEventListener("mouseleave", () => {
    clearTimeout(tipTimer);
    tipEl().hidden = true;
  });
  el.addEventListener("mousedown", () => {
    clearTimeout(tipTimer);
    tipEl().hidden = true;
  });
}
