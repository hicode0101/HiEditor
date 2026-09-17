// Markdown 预览（FR-7.2a v1.7）：Edit（源码）/ Preview（渲染视图）分段切换。
// 渲染用 marked（vendor/md.js）；预览为只读视图，缓冲区始终是 Markdown 源文本。
// 可见性仲裁统一在 main.js syncContentView。

import { state, activeTab } from "./state.js";
import { t } from "./i18n.js";
import { initCopyContextMenu } from "./ui.js";

const invoke = (...args) => window.__TAURI__.core.invoke(...args);

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
      resolveLocalImages(pv, tab);
    })
    .catch(() => {});
}

// 预览里的 <img> 相对路径以 webview 虚拟域名为基准，指不到磁盘文件；
// 解析到 md 所在目录后经 read_binary_file 读字节转 data URL，按路径缓存避免重复读盘。
const IMG_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};
const imgCache = new Map(); // 绝对路径 -> data URL 的 Promise

async function loadLocalImage(path) {
  const ext = path.includes(".") ? path.split(".").pop().toLowerCase() : "";
  const mime = IMG_MIME[ext] || "application/octet-stream";
  const buf = await invoke("read_binary_file", { path });
  return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(new Blob([buf], { type: mime }));
  });
}

function resolveLocalImages(pv, tab) {
  const dir = tab.path ? tab.path.replace(/[\\/][^\\/]*$/, "") : "";
  pv.querySelectorAll("img[src]").forEach(async (img) => {
    const raw = img.getAttribute("src");
    if (!raw || /^(https?:|data:|blob:|file:|mailto:|tauri:|asset:)/i.test(raw)) return;
    let rel;
    try { rel = decodeURIComponent(raw); } catch { rel = raw; } // md 里 %20 等转义还原
    const absolute = /^[a-zA-Z]:[\\/]/.test(rel) || /^[/\\]/.test(rel);
    if (!absolute && !dir) return; // 未保存的文件无从解析相对路径
    const full = absolute ? rel : dir + "/" + rel.replace(/^\.\//, "");
    let p = imgCache.get(full);
    if (!p) {
      if (imgCache.size > 100) imgCache.clear();
      p = loadLocalImage(full);
      imgCache.set(full, p);
    }
    try {
      img.src = await p;
    } catch {
      imgCache.delete(full); // 图片缺失/读取失败：保留破图标记，缓存剔除以便重试
    }
  });
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

// 同步编辑/预览分段按钮的高亮态（在 syncContentView 统一调用）
export function syncMdSegButtons() {
  const tab = activeTab();
  const seg = { source: "edit", wysiwyg: "preview" }[isMarkdownTab(tab) ? tab.mode : null];
  document.querySelectorAll("#md-bar .md-seg-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mdmode === seg);
  });
}

export function initMarkdownPreview() {
  document.getElementById("md-bar").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mdmode]");
    if (!btn) return;
    setMarkdownMode(btn.dataset.mdmode === "preview" ? "wysiwyg" : "source");
  });
  // 预览区右键复制菜单 + Ctrl+C（共享 helper，与 PDF 文本层同一套）
  initCopyContextMenu(document.getElementById("md-preview"));
}
