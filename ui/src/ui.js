// 浮层组件：下拉菜单（UI-5.1）、错误对话框（UI-5.4 风格）、tooltip（UI-1.7 样式）

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
      const holder = document.createElement("div");
      holder.style.position = "relative";
      const parentBtn = buildItem({
        ...item,
        action: () => {
          const sub = document.createElement("div");
          sub.className = "menu-flyout";
          for (const child of item.submenu) sub.appendChild(buildItem(child));
          const rect = holder.getBoundingClientRect();
          sub.style.left = rect.right - 4 + "px";
          sub.style.top = rect.top + "px";
          layer().appendChild(sub);
        },
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
export function showDialog({ title, body = "", buttons = [{ label: "确定", primary: true, value: true }] }) {
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

// ===== 横幅（FR-14） =====

export function showBanner({ message, buttons = [], info = false, autoHideMs = 0 }) {
  dismissBanner();
  const banner = document.createElement("div");
  banner.className = "banner" + (info ? " info" : "");
  const text = document.createElement("span");
  text.className = "bn-text";
  text.textContent = message;
  banner.appendChild(text);
  for (const b of buttons) {
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
  if (autoHideMs > 0) setTimeout(dismissBanner, autoHideMs);
}

export function dismissBanner() {
  document.getElementById("active-banner")?.remove();
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
