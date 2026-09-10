// PDF 查看器（pdf.js）：只读连续滚动 + 页数/缩放信息 + 文本层选择复制。
// 二进制数据经 read_binary_file（ArrayBuffer）加载，渲染进 #pdf-view。

import { state, activeTab } from "./state.js";

const invoke = (...args) => window.__TAURI__.core.invoke(...args);

let pdfjsReady = null;

async function getPdfJs() {
  if (!pdfjsReady) {
    pdfjsReady = (async () => {
      const lib = await import("/vendor/pdf.min.mjs");
      lib.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";
      return lib;
    })();
  }
  return pdfjsReady;
}

export function isPdfTab(tab) {
  return !!(tab && tab.lang === "pdf");
}

export function isPdfViewActive() {
  const tab = activeTab();
  return isPdfTab(tab);
}

// 加载并渲染当前 pdf 标签（重复调用安全：已完整渲染则跳过）
export async function renderPdfTab() {
  const tab = activeTab();
  if (!isPdfTab(tab)) return;
  const view = document.getElementById("pdf-view");
  if (view.dataset.tabId === String(tab.id) && tab.pdfRendered) {
    updatePdfInfo(tab);
    return;
  }
  const pdfjs = await getPdfJs();
  if (!tab.pdfData) {
    tab.pdfData = await invoke("read_binary_file", { path: tab.path });
  }
  const doc = await pdfjs.getDocument({ data: tab.pdfData.slice(0) }).promise;
  tab.pdfDoc = doc;
  if (tab.pdfScale == null) {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    tab.pdfScale = Math.max(0.2, Math.min(4, ((view.clientWidth || 800) - 48) / base.width));
  }
  view.innerHTML = "";
  view.dataset.tabId = String(tab.id);
  for (let n = 1; n <= doc.numPages; n++) {
    if (activeTab() !== tab) return; // 用户切走，中止渲染（已完成页保留）
    await renderPage(tab, doc, n);
  }
  tab.pdfRendered = true;
  updatePdfInfo(tab);
}

async function renderPage(tab, doc, n) {
  const pdfjs = await getPdfJs();
  const view = document.getElementById("pdf-view");
  const page = await doc.getPage(n);
  const scale = tab.pdfScale || 1;
  const viewport = page.getViewport({ scale });
  const holder = document.createElement("div");
  holder.className = "pdf-page";
  holder.style.width = Math.round(viewport.width) + "px";
  holder.style.height = Math.round(viewport.height) + "px";
  holder.style.setProperty("--scale-factor", scale);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width * 2);
  canvas.height = Math.round(viewport.height * 2);
  canvas.style.width = Math.round(viewport.width) + "px";
  canvas.style.height = Math.round(viewport.height) + "px";
  holder.appendChild(canvas);
  const textDiv = document.createElement("div");
  textDiv.className = "textLayer";
  holder.appendChild(textDiv);
  view.appendChild(holder);
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  const tl = new pdfjs.TextLayer({
    textContentSource: page.streamTextContent(),
    container: textDiv,
  });
  await tl.render();
  updatePdfInfo(tab);
}

function updatePdfInfo(tab) {
  const info = document.getElementById("pdf-page-info");
  if (info && tab && tab.pdfDoc) {
    info.textContent = `${tab.pdfDoc.numPages} 页 · ${Math.round((tab.pdfScale || 1) * 100)}%`;
  }
}

export function zoomPdf(delta) {
  const tab = activeTab();
  if (!isPdfTab(tab)) return;
  tab.pdfScale = Math.max(0.2, Math.min(5, (tab.pdfScale || 1) + delta));
  tab.pdfRendered = false;
  const view = document.getElementById("pdf-view");
  view.innerHTML = "";
  view.dataset.tabId = "";
  renderPdfTab();
}

export function initPdfViewer() {
  document.getElementById("pdf-zoom-out").addEventListener("click", () => zoomPdf(-0.2));
  document.getElementById("pdf-zoom-in").addEventListener("click", () => zoomPdf(0.2));
}
