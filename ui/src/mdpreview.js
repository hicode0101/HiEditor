// Markdown 预览（FR-7.2 v1.7）：Edit（源码）/ Preview（渲染视图）分段切换。
// 渲染用 marked（vendor/md.js）；预览为只读视图，缓冲区始终是 Markdown 源文本。

import { state, activeTab } from "./state.js";
import { getDocText } from "./editor.js";
import { renderMarkdown } from "/vendor/md.js";

export function isMarkdownTab(tab) {
  return !!(tab && tab.lang === "markdown");
}

// 按当前激活标签同步：md 标签显示切换条并按 tab.mode 渲染；其它标签恢复编辑区
export function applyMarkdownMode() {
  const tab = activeTab();
  const isMd = isMarkdownTab(tab);
  document.getElementById("md-bar").hidden = !isMd;

  const previewing = isMd && tab.mode === "wysiwyg";
  document.getElementById("editor").hidden = previewing;
  const pv = document.getElementById("md-preview");
  pv.hidden = !previewing;
  if (previewing) {
    pv.innerHTML = renderMarkdown(getDocText());
    pv.scrollTop = 0;
  }
  if (isMd) updateSegButtons(tab);
}

function updateSegButtons(tab) {
  const previewing = tab.mode === "wysiwyg";
  document.querySelector('#md-bar [data-mdmode="edit"]')?.classList.toggle("active", !previewing);
  document.querySelector('#md-bar [data-mdmode="preview"]')?.classList.toggle("active", previewing);
}

// 切换模式（供分段按钮 / 工具栏 / 查看菜单共用）
export function setMarkdownMode(mode) {
  const tab = activeTab();
  if (!isMarkdownTab(tab) || tab.mode === mode) return;
  tab.mode = mode;
  window.dispatchEvent(new CustomEvent("tabs-refresh"));
}

export function initMarkdownPreview() {
  document.getElementById("md-bar").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mdmode]");
    if (!btn) return;
    setMarkdownMode(btn.dataset.mdmode === "preview" ? "wysiwyg" : "source");
  });
  window.addEventListener("tab-switched", applyMarkdownMode);
  window.addEventListener("tabs-refresh", applyMarkdownMode);
  window.addEventListener("tab-updated", applyMarkdownMode);
}
