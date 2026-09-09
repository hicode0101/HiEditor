// 工具栏（UI-2.5 Markdown 自定义工具栏，由插件 config.json toolbar 声明驱动）
// 默认工具栏（字体/字号）绑定见 main.js initFontControls

import { activeTab } from "./state.js";
import { openMenu, openPopover, closeFlyout, showBanner, bindTooltip } from "./ui.js";
import { t } from "./i18n.js";
import { scheduleSessionSave } from "./session.js";
import {
  replaceSelection, setHeading, toggleLinePrefix, toggleNumberedPrefix,
  insertBlock, markDirty, transformSelection,
} from "./editor.js";

export function initToolbars() {
  // ===== Markdown 自定义工具栏（插件声明 toolbar.id = "markdown-wysiwyg"）=====
  const md = (name) => document.querySelector(`#toolbar-markdown-wysiwyg [data-md="${name}"]`);
  bindHeadingDropdown(md("heading"));
  bindTablePicker(md("table"));

  md("bold").addEventListener("click", () => replaceSelection("**", "**", t("toolbar.ph.bold")));
  md("italic").addEventListener("click", () => replaceSelection("*", "*", t("toolbar.ph.italic")));
  md("underline").addEventListener("click", () => replaceSelection("<u>", "</u>", t("toolbar.ph.underline")));
  md("strike").addEventListener("click", () => replaceSelection("~~", "~~", t("toolbar.ph.strike")));
  md("code").addEventListener("click", () => replaceSelection("`", "`", t("toolbar.ph.code")));
  md("clear").addEventListener("click", clearFormatting);
  md("hr").addEventListener("click", () => insertBlock("\n---\n"));
  md("quote").addEventListener("click", () => toggleLinePrefix("> "));
  md("ul").addEventListener("click", () => toggleLinePrefix("- "));
  md("ol").addEventListener("click", () => toggleNumberedPrefix());
  md("task").addEventListener("click", () => toggleLinePrefix("- [ ] "));
  md("task-done").addEventListener("click", () => toggleLinePrefix("- [x] "));
  md("link").addEventListener("click", insertLink);
  md("image").addEventListener("click", () => replaceSelection("![", "](https://)", t("toolbar.ph.desc")));
  md("codeblock").addEventListener("click", () => insertBlock("\n```text\n\n```\n"));
  md("formula").addEventListener("click", () => insertBlock("\n$$\nE = mc^2\n$$\n"));
  md("help").addEventListener("click", showMarkdownHelp);

  // 编辑模式切换（源码 ⇄ 预览，FR-7.2：与编辑区上方 Edit/Preview 分段控件同状态）
  bindTooltip(md("mode-wysiwyg"), () => t("toolbar.modeWysiwyg"));
  bindTooltip(md("mode-source"), () => t("toolbar.modeSource"));
  md("mode-wysiwyg").addEventListener("click", () => setTabMode("wysiwyg"));
  md("mode-source").addEventListener("click", () => setTabMode("source"));
  window.addEventListener("tab-switched", updateModeBtn);
  window.addEventListener("tabs-refresh", updateModeBtn);

  // ===== 溢出收纳（v1.7）：窗口宽度不足时隐藏末尾工具项，"⋯"按钮换行展开剩余项 =====
  for (const container of document.querySelectorAll(".toolbar")) ensureOverflowBtn(container);
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(updateToolbarOverflow, 100);
  });
  // 浮层经 ui.js 的"点击外部/Esc"关闭时，把收纳进面板的工具项复位回工具栏
  document.addEventListener("mousedown", (e) => {
    if (overflowOpen() && !e.target.closest(".toolbar-overflow-panel") && !e.target.closest(".tl-overflow")) {
      setTimeout(updateToolbarOverflow, 0); // 在 ui.js 关闭浮层之后执行
    }
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overflowOpen()) setTimeout(updateToolbarOverflow, 0);
  });
}

// ===== 工具栏溢出收纳 =====

const overflowState = new Map(); // container -> { items: 初始工具项, btn: "⋯"按钮 }

function ensureOverflowBtn(container) {
  if (overflowState.has(container)) return overflowState.get(container);
  const st = { items: [...container.children], btn: null };
  const btn = document.createElement("button");
  btn.className = "tl-btn tl-overflow";
  btn.hidden = true;
  btn.title = t("toolbar.more");
  btn.innerHTML = `<span>⋯</span>`;
  btn.addEventListener("click", () => {
    if (overflowOpen()) { closeFlyout(); updateToolbarOverflow(); return; } // 再点一次 = 收起
    openOverflowPanel(container);
  });
  container.appendChild(btn);
  st.btn = btn;
  overflowState.set(container, st);
  return st;
}

function overflowOpen() {
  return [...overflowState.values()].some((st) => st.items.some((it) => it.parentElement !== st.btn.parentElement));
}

// 量测各可见工具栏：装不下的末尾项隐藏；仅在确有隐藏项时显示"⋯"按钮。
// 两遍量测：先不预留"⋯"位置判断是否全放得下（避免边界宽度下多藏一项），
// 放不下时再预留"⋯"位隐藏末尾项。
export function updateToolbarOverflow() {
  for (const container of document.querySelectorAll(".toolbar")) {
    const st = ensureOverflowBtn(container);
    if (container.closest("[hidden]")) continue; // 隐藏的工具栏不参与量测
    for (const it of st.items) {
      if (it.parentElement !== container) container.insertBefore(it, st.btn); // 从面板复位
      it.style.display = "";
    }
    st.btn.hidden = true;
    if (container.clientWidth <= 0) continue;

    const gap = 4; // 与 .toolbar gap 一致
    // Pass 1：不预留"⋯"位，全部项能放下就全部显示
    let total = 0;
    for (const it of st.items) total += it.offsetWidth + gap;
    if (total <= container.clientWidth) continue;

    // Pass 2：预留"⋯"位，隐藏末尾装不下的项
    const btnW = st.btn.offsetWidth || 34;
    let avail = container.clientWidth - btnW - gap;
    let used = 0;
    let hiddenCount = 0;
    for (const it of st.items) {
      used += it.offsetWidth + gap;
      if (used > avail) {
        it.style.display = "none";
        hiddenCount++;
      }
    }
    if (hiddenCount > 0) st.btn.hidden = false;
  }
}

// "⋯"弹层：隐藏的工具项移入换行面板（DOM 节点原样搬移，事件监听保留）
function openOverflowPanel(container) {
  closeFlyout();
  const st = overflowState.get(container);
  const panel = document.createElement("div");
  panel.className = "menu-flyout toolbar-overflow-panel";
  for (const it of st.items) {
    if (it.style.display === "none") {
      it.style.display = "";
      panel.appendChild(it);
    }
  }
  openPopover(st.btn, panel);
  const r = st.btn.getBoundingClientRect();
  const pw = Math.min(360, window.innerWidth - 16);
  let left = r.right - pw;
  if (left < 8) left = 8;
  panel.style.left = left + "px";
  panel.style.top = r.bottom + 4 + "px";
  // 面板内点击普通工具项：执行后收起面板并复位（document 委托，面板可能已被动作移除）。
  // 自带下拉的项（标题/表格/更多）跳过：其 openMenu/openPopover 自行接管浮层，
  // 若在此收起会把刚打开的下拉一并关掉。
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".tl-btn");
    if (!b || !e.target.closest(".toolbar-overflow-panel")) return;
    if (b.querySelector(".chev")) return;
    setTimeout(() => {
      closeFlyout();
      updateToolbarOverflow();
    }, 0);
  });
}

// 面板内点击时，下拉锚点按钮将随面板一起被关闭移除（rect 归零），
// 此时把点击坐标传给 openMenu 定位；工具栏内正常点击仍按按钮矩形定位
function flyoutPos(e) {
  return e.target.closest(".toolbar-overflow-panel")
    ? { x: e.clientX, y: e.clientY }
    : {};
}

// ===== Markdown 编辑模式切换（FR-7.2：源码 ⇄ 所见即所得）=====

function updateModeBtn() {
  const bW = document.querySelector('#toolbar-markdown-wysiwyg [data-md="mode-wysiwyg"]');
  const bS = document.querySelector('#toolbar-markdown-wysiwyg [data-md="mode-source"]');
  if (!bW || !bS) return;
  const tab = activeTab();
  const isMd = tab && tab.lang === "markdown";
  const wysiwyg = isMd && tab.mode === "wysiwyg";
  bW.classList.toggle("toggled", wysiwyg);
  bS.classList.toggle("toggled", isMd && !wysiwyg);
}

function setTabMode(mode) {
  const tab = activeTab();
  if (!tab || tab.lang !== "markdown" || tab.mode === mode) return;
  tab.mode = mode;
  window.dispatchEvent(new CustomEvent("tabs-refresh")); // 触发 applyMarkdownMode 重渲染
  scheduleSessionSave();
}

function clearFormatting() {
  transformSelection((selected) =>
    selected
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/~~(.*?)~~/g, "$1")
      .replace(/`(.*?)`/g, "$1")
      .replace(/<u>(.*?)<\/u>/g, "$1")
  );
}

function insertLink() {
  replaceSelection("[", "](https://)", t("toolbar.ph.link"));
}

const headingItems = () => [
  { label: t("status.plainText"), level: 0 },
  { sep: true },
  { label: t("toolbar.heading1"), level: 1 },
  { label: t("toolbar.heading2"), level: 2 },
  { label: t("toolbar.heading3"), level: 3 },
  { label: t("toolbar.heading4"), level: 4 },
  { label: t("toolbar.heading5"), level: 5 },
  { label: t("toolbar.heading6"), level: 6 },
];

function bindHeadingDropdown(btn) {
  btn.addEventListener("click", (e) => {
    const tab = activeTab();
    openMenu(
      btn,
      headingItems().map((h) =>
        h.sep
          ? { sep: true }
          : {
              label: h.label,
              disabled: !tab,
              action: () => setHeading(h.level),
            }
      ),
      flyoutPos(e)
    );
  });
}

const HELP_MD = [
  "# 标题 1        ## 标题 2        ### 标题 3",
  "**粗体**   *斜体*   ~~删除线~~   <u>下划线</u>   `行内代码`",
  "- 无序列表        1. 有序列表        - [ ] 任务",
  "> 引用",
  "[链接](https://example.com)    ![图片](url)",
  "---（分隔线）    | 表 | 格 |（表格）    ```（代码块）",
].join("\n");

function showMarkdownHelp() {
  import("./ui.js").then(({ showDialog }) =>
    showDialog({ title: t("toolbar.help"), body: HELP_MD })
  );
}

// ===== 表格尺寸选择器（UI-5.6）：8×8 网格 =====

function bindTablePicker(btn) {
  btn.addEventListener("click", (e) => {
    const fly = document.createElement("div");
    fly.className = "menu-flyout";
    fly.style.padding = "10px";
    const label = document.createElement("div");
    label.style.cssText =
      "text-align:center;margin-bottom:6px;color:var(--text-secondary);font-size:12px";
    label.textContent = "1 × 1";
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(8,20px);gap:2px;";
    let rows = 0,
      cols = 0;
    for (let r = 1; r <= 8; r++) {
      for (let c = 1; c <= 8; c++) {
        const cell = document.createElement("div");
        cell.style.cssText =
          "width:20px;height:20px;border:1px solid var(--row-divider);border-radius:2px;background:var(--input-bg)";
        cell.dataset.rc = `${r},${c}`;
        cell.addEventListener("mouseenter", () => {
          rows = r;
          cols = c;
          label.textContent = `${r} × ${c}`;
          grid.querySelectorAll("div").forEach((d) => {
            const [dr, dc] = d.dataset.rc.split(",").map(Number);
            d.style.background = dr <= r && dc <= c ? "var(--accent)" : "#fff";
          });
        });
        cell.addEventListener("click", () => {
          closeFlyout();
          insertTable(rows, cols);
        });
        grid.appendChild(cell);
      }
    }
    fly.append(label, grid);
    openPopover(btn, fly);
    if (e.target.closest(".toolbar-overflow-panel")) {
      // 面板内点击：锚点按钮随面板关闭移除，改用点击坐标定位
      let left = Math.min(e.clientX, window.innerWidth - 220);
      fly.style.left = Math.max(8, left) + "px";
      fly.style.top = e.clientY + 4 + "px";
    } else {
      const rect = btn.getBoundingClientRect();
      fly.style.left = rect.left + "px";
      fly.style.top = rect.bottom + 2 + "px";
    }
  });
}

function insertTable(rows, cols) {
  if (rows < 1 || cols < 1) return;
  const header = "| " + Array.from({ length: cols }, (_, i) => `${i18n_t("toolbar.tableCol", { n: i + 1 })}`).join(" | ") + " |";
  const divider = "| " + Array.from({ length: cols }, () => "---").join(" | ") + " |";
  const body = Array.from({ length: rows - 1 }, () =>
    "|" + Array.from({ length: cols }, () => "  ").join("|") + "|"
  );
  const lines = [header, divider, ...body];
  insertBlock("\n" + lines.join("\n") + "\n");
}
