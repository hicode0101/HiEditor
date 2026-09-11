// PDF 查看器（pdf.js）：只读连续滚动 + 页码跳转/适应页面/适应宽度/缩放 + 文本层选择复制。
// 二进制数据经 read_binary_file（ArrayBuffer）加载，渲染进 #pdf-view。

import { activeTab } from "./state.js";

const invoke = (...args) => window.__TAURI__.core.invoke(...args);

const MIN_SCALE = 0.2;
const MAX_SCALE = 5;

let pdfjsReady = null;
let pageObserver = null; // 滚动跟踪当前页（IntersectionObserver）
let renderSeq = 0;       // 渲染会话号：缩放/切标签后旧的逐页渲染循环作废

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
  return isPdfTab(activeTab());
}

function clampScale(scale) {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}

async function firstPageSize(doc) {
  const page = await doc.getPage(1);
  return page.getViewport({ scale: 1 });
}

function fitWidthScale(view, base) {
  return clampScale(((view.clientWidth || 800) - 48) / base.width);
}

// 加载并渲染当前 pdf 标签（重复调用安全：已完整渲染则只同步信息栏）
export async function renderPdfTab() {
  const tab = activeTab();
  if (!isPdfTab(tab)) return;
  const view = document.getElementById("pdf-view");
  if (view.dataset.tabId === String(tab.id) && tab.pdfRendered) {
    syncPdfBar(tab);
    return;
  }
  const pdfjs = await getPdfJs();
  if (!tab.pdfData) {
    tab.pdfData = await invoke("read_binary_file", { path: tab.path });
  }
  const doc = await pdfjs.getDocument({ data: tab.pdfData.slice(0) }).promise;
  tab.pdfDoc = doc;
  const seq = ++renderSeq;
  if (tab.pdfScale == null) {
    tab.pdfScale = fitWidthScale(view, await firstPageSize(doc));
  }
  tab.pdfHolders = {};
  tab.pdfPendingPage = null;
  tab.pdfCurrentPage = 1;
  view.innerHTML = "";
  view.dataset.tabId = String(tab.id);
  setupPageObserver(view);
  syncPdfBar(tab); // 文档信息就绪：立即重置页码/缩放/翻页按钮，避免残留上一个标签的状态
  for (let n = 1; n <= doc.numPages; n++) {
    if (seq !== renderSeq || activeTab() !== tab) return; // 缩放/切走：中止，重入时重建
    await renderPage(tab, doc, n);
  }
  tab.pdfRendered = true;
  syncPdfBar(tab);
}

async function renderPage(tab, doc, n) {
  const pdfjs = await getPdfJs();
  const view = document.getElementById("pdf-view");
  const page = await doc.getPage(n);
  const scale = tab.pdfScale || 1;
  const viewport = page.getViewport({ scale });
  const holder = document.createElement("div");
  holder.className = "pdf-page";
  holder.dataset.page = String(n);
  holder.style.width = Math.round(viewport.width) + "px";
  holder.style.height = Math.round(viewport.height) + "px";
  holder.style.setProperty("--scale-factor", scale);
  const canvas = document.createElement("canvas");
  // 位图按 dpr 放大提升清晰度；必须同步传 transform，否则 pdf.js 仍按 1× 绘制，
  // 内容缩在位图左上角 1/4，页面右/下方出现大片空白（内容视觉上缩小一半）
  const dpr = Math.min(window.devicePixelRatio || 1, 2) || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = Math.round(viewport.width) + "px";
  canvas.style.height = Math.round(viewport.height) + "px";
  holder.appendChild(canvas);
  const textDiv = document.createElement("div");
  textDiv.className = "textLayer";
  textDiv.style.setProperty("--total-scale-factor", scale);
  holder.appendChild(textDiv);
  view.appendChild(holder);
  tab.pdfHolders[n] = holder;
  if (pageObserver) pageObserver.observe(holder);
  const ctx = canvas.getContext("2d");
  await page.render({
    canvasContext: ctx,
    viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
  }).promise;
  const tl = new pdfjs.TextLayer({
    textContentSource: page.streamTextContent(),
    container: textDiv,
    viewport,
  });
  await tl.render();
  if (tab.pdfPendingPage === n) {
    tab.pdfPendingPage = null;
    holder.scrollIntoView({ block: "start" });
  }
  syncPdfBar(tab);
}

// 工具栏信息同步：当前页 / 总页数 / 缩放百分比 / 翻页按钮可用态
function syncPdfBar(tab) {
  if (!isPdfTab(tab) || !tab.pdfDoc || activeTab() !== tab) return;
  const total = document.getElementById("pdf-page-total");
  const zoomEl = document.getElementById("pdf-zoom-level");
  const input = document.getElementById("pdf-page-input");
  if (total) total.textContent = `/ ${tab.pdfDoc.numPages}`;
  if (zoomEl) zoomEl.textContent = `${Math.round((tab.pdfScale || 1) * 100)}%`;
  if (input && document.activeElement !== input) {
    const cur = String(tab.pdfCurrentPage || 1);
    if (input.value !== cur) input.value = cur;
  }
  updatePdfNav(tab);
}

// 上一页/下一页按钮：第一页/最后一页时置灰不可点
function updatePdfNav(tab) {
  const prev = document.getElementById("pdf-prev-page");
  const next = document.getElementById("pdf-next-page");
  if (!prev && !next) return;
  if (!isPdfTab(tab) || !tab.pdfDoc) {
    prev.disabled = next.disabled = true;
    return;
  }
  const cur = tab.pdfCurrentPage || 1;
  prev.disabled = cur <= 1;
  next.disabled = cur >= tab.pdfDoc.numPages;
}

// 滚动跟踪当前页：取可视比例最大的页写回输入框
function setupPageObserver(view) {
  if (pageObserver) pageObserver.disconnect();
  pageObserver = new IntersectionObserver(
    (entries) => {
      const tab = activeTab();
      if (!isPdfTab(tab)) return;
      let best = null;
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        if (!best || en.intersectionRatio > best.intersectionRatio) best = en;
      }
      if (!best) return;
      const n = parseInt(best.target.dataset.page, 10);
      if (!n) return;
      tab.pdfCurrentPage = n;
      const input = document.getElementById("pdf-page-input");
      if (input && document.activeElement !== input) input.value = String(n);
      updatePdfNav(tab);
    },
    { root: view, threshold: [0, 0.25, 0.5, 0.75, 1] }
  );
}

export function zoomPdf(delta) {
  const tab = activeTab();
  if (!isPdfTab(tab) || !tab.pdfDoc) return;
  applyScale(tab, (tab.pdfScale || 1) + delta);
}

export function resetPdfZoom() {
  const tab = activeTab();
  if (!isPdfTab(tab) || !tab.pdfDoc) return;
  applyScale(tab, 1);
}

export function fitPdfWidth() {
  const tab = activeTab();
  if (!isPdfTab(tab) || !tab.pdfDoc) return;
  const view = document.getElementById("pdf-view");
  firstPageSize(tab.pdfDoc).then((base) => applyScale(tab, fitWidthScale(view, base)));
}

export function fitPdfPage() {
  const tab = activeTab();
  if (!isPdfTab(tab) || !tab.pdfDoc) return;
  const view = document.getElementById("pdf-view");
  firstPageSize(tab.pdfDoc).then((base) => {
    applyScale(tab, Math.min(
      ((view.clientWidth || 800) - 48) / base.width,
      ((view.clientHeight || 600) - 48) / base.height
    ));
  });
}

function applyScale(tab, scale) {
  tab.pdfScale = clampScale(scale);
  tab.pdfRendered = false;
  syncPdfBar(tab); // 百分比立即更新，逐页重渲染随后进行
  renderPdfTab();
}

export function goToPage(n) {
  const tab = activeTab();
  if (!isPdfTab(tab) || !tab.pdfDoc) return;
  n = Math.max(1, Math.min(tab.pdfDoc.numPages, Math.round(n) || 1));
  tab.pdfCurrentPage = n;
  const holder = tab.pdfHolders && tab.pdfHolders[n];
  if (holder) {
    holder.scrollIntoView({ block: "start" });
  } else {
    tab.pdfPendingPage = n; // 该页尚未渲染完，renderPage 完成后补跳
  }
  syncPdfBar(tab);
  // 边界页上 observer 可能不再回调（无滚动变化），翻页按钮状态在此兜底刷新
  updatePdfNav(tab);
}

export function initPdfViewer() {
  document.getElementById("pdf-zoom-out").addEventListener("click", () => zoomPdf(-0.2));
  document.getElementById("pdf-zoom-in").addEventListener("click", () => zoomPdf(0.2));
  document.getElementById("pdf-prev-page").addEventListener("click", () => {
    const tab = activeTab();
    if (isPdfTab(tab)) goToPage((tab.pdfCurrentPage || 1) - 1);
  });
  document.getElementById("pdf-next-page").addEventListener("click", () => {
    const tab = activeTab();
    if (isPdfTab(tab)) goToPage((tab.pdfCurrentPage || 1) + 1);
  });
  document.getElementById("pdf-fit-page").addEventListener("click", () => fitPdfPage());
  document.getElementById("pdf-fit-width").addEventListener("click", () => fitPdfWidth());
  const input = document.getElementById("pdf-page-input");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      goToPage(parseInt(input.value, 10));
      input.blur();
    }
  });
  input.addEventListener("blur", () => syncPdfBar(activeTab())); // 无效输入回显当前页
  // Ctrl+滚轮缩放 PDF（阻断冒泡：避免同时触发编辑器的全局缩放）
  document.getElementById("pdf-view").addEventListener("wheel", (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      zoomPdf(e.deltaY < 0 ? 0.1 : -0.1);
    }
  }, { passive: false });
}
