// B 区工具栏（UI-2.3 默认工具栏 / UI-2.5 Markdown 工具栏）+ 表格选择器（UI-5.6）

import { activeTab } from "./state.js";
import { openPopover } from "./ui.js";
import {
  replaceSelection, setHeading, toggleLinePrefix, toggleNumberedPrefix,
  insertBlock, markDirty, transformSelection,
} from "./editor.js";

export function initToolbars() {
  // ===== 默认工具栏（非 Markdown：全部禁用，保持基准截图一形态） =====
  document.querySelectorAll("#toolbar-default .tl-btn").forEach((btn) => {
    btn.disabled = true;
  });
  // 即使禁用也提供 H1 下拉与表格选择器逻辑（Markdown 工具栏共用）
  bindHeadingDropdown(document.querySelector('#toolbar-default [data-tl="heading"]'));
  bindListDropdown(document.querySelector('#toolbar-default [data-tl="list"]'));
  bindTablePicker(document.querySelector('#toolbar-default [data-tl="table"]'));

  // ===== Markdown 工具栏（UI-2.5） =====
  const md = (name) => document.querySelector(`#toolbar-markdown [data-md="${name}"]`);
  bindHeadingDropdown(md("heading"));
  bindTablePicker(md("table"));
  bindMoreDropdown(md("more"));

  md("bold").addEventListener("click", () => replaceSelection("**", "**", "粗体文本"));
  md("italic").addEventListener("click", () => replaceSelection("*", "*", "斜体文本"));
  md("underline").addEventListener("click", () => replaceSelection("<u>", "</u>", "下划线文本"));
  md("strike").addEventListener("click", () => replaceSelection("~~", "~~", "删除线文本"));
  md("code").addEventListener("click", () => replaceSelection("`", "`", "代码"));
  md("clear").addEventListener("click", clearFormatting);
  md("hr").addEventListener("click", () => insertBlock("\n---\n"));
  md("quote").addEventListener("click", () => toggleLinePrefix("> "));
  md("ul").addEventListener("click", () => toggleLinePrefix("- "));
  md("ol").addEventListener("click", () => toggleNumberedPrefix());
  md("task").addEventListener("click", () => toggleLinePrefix("- [ ] "));
  md("task-done").addEventListener("click", () => toggleLinePrefix("- [x] "));
  md("link").addEventListener("click", insertLink);
  md("image").addEventListener("click", () => replaceSelection("![", "](https://)", "描述文本"));
  md("codeblock").addEventListener("click", () => insertBlock("\n```text\n\n```\n"));
  md("formula").addEventListener("click", () => insertBlock("\n$$\nE = mc^2\n$$\n"));
  md("help").addEventListener("click", showMarkdownHelp);
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
  replaceSelection("[", "](https://)", "链接文本");
}

const HEADINGS = [
  { label: "正文", level: 0 },
  { sep: true },
  { label: "标题 1", level: 1 },
  { label: "标题 2", level: 2 },
  { label: "标题 3", level: 3 },
  { label: "标题 4", level: 4 },
  { label: "标题 5", level: 5 },
  { label: "标题 6", level: 6 },
];

function bindHeadingDropdown(btn) {
  btn.addEventListener("click", () => {
    const tab = activeTab();
    openMenu(
      btn,
      HEADINGS.map((h) =>
        h.sep
          ? { sep: true }
          : {
              label: h.label,
              disabled: !tab,
              action: () => setHeading(h.level),
            }
      )
    );
  });
}

function bindListDropdown(btn) {
  btn.addEventListener("click", () => {
    openMenu(btn, [
      { label: "无序列表", action: () => toggleLinePrefix("- ") },
      { label: "有序列表", action: () => toggleNumberedPrefix() },
    ]);
  });
}

function bindMoreDropdown(btn) {
  btn.addEventListener("click", () => {
    openMenu(btn, [
      { label: "脚注", disabled: true },
      { label: "目录", disabled: true },
      { label: "表情", disabled: true },
      { sep: true },
      { label: "切换为源码模式", disabled: true }, // M2：WYSIWYG 接入后启用（FR-7.6）
    ]);
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
    showDialog({ title: "Markdown 语法速查", body: HELP_MD })
  );
}

// ===== 表格尺寸选择器（UI-5.6）：8×8 网格 =====

function bindTablePicker(btn) {
  btn.addEventListener("click", () => {
    const fly = document.createElement("div");
    fly.className = "menu-flyout";
    fly.style.padding = "10px";
    const label = document.createElement("div");
    label.style.cssText =
      "text-align:center;margin-bottom:6px;color:var(--text-secondary);font-size:12px";
    label.textContent = "1 行 × 1 列";
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
          label.textContent = `${r} 行 × ${c} 列`;
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
    const rect = btn.getBoundingClientRect();
    fly.style.left = rect.left + "px";
    fly.style.top = rect.bottom + 2 + "px";
  });
}

function insertTable(rows, cols) {
  if (rows < 1 || cols < 1) return;
  const header = "| " + Array.from({ length: cols }, (_, i) => `列${i + 1}`).join(" | ") + " |";
  const divider = "| " + Array.from({ length: cols }, () => "---").join(" | ") + " |";
  const body = Array.from({ length: rows - 1 }, () =>
    "|" + Array.from({ length: cols }, () => "  ").join("|") + "|"
  );
  const lines = [header, divider, ...body];
  insertBlock("\n" + lines.join("\n") + "\n");
}
