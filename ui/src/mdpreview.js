// Markdown 预览（FR-7.2a v1.7）：Edit（源码）/ Preview（渲染视图）分段切换。
// 渲染用 marked（vendor/md.js）；预览为只读视图，缓冲区始终是 Markdown 源文本。
// 可见性仲裁统一在 main.js syncContentView。

import { state, activeTab } from "./state.js";
import { t } from "./i18n.js";

export function isMarkdownTab(tab) {
  return !!(tab && tab.lang === "markdown");
}

export function mdPreviewActive(tab) {
  return !!(tab && tab.lang === "markdown" && tab.mode === "wysiwyg");
}

// 渲染 Markdown 预览面板（调用方保证当前应处于预览态）
export function renderMdPreview() {
  const tab = activeTab();
  if (!isMarkdownTab(tab)) return;
  const pv = document.getElementById("md-preview");
  import("/vendor/md.js")
    .then(({ renderMarkdown }) => {
      pv.innerHTML = renderMarkdown(getDocTextOf(tab));
      pv.scrollTop = 0;
    })
    .catch(() => {});
}

function getDocTextOf(tab) {
  return tab === activeTab() ? getDocText() : tab.text || "";
}

import { getDocText } from "./editor.js";

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
}
