// ===== 分屏模式滚动同步（编辑区 ⇄ 预览区）=====
// 移植自 HiNote src/lib/splitSync.ts（逻辑一致，TS → 纯 JS；CM6 view API 相同）。
// 核心是一张"分段线性映射表"：预览里每个 [data-line] 锚点（块级元素源码
// 起始行，0 基）与下一锚点构成一段，段的两端在编辑区（文档相对像素）与
// 预览区（内容偏移）之间线性对应。解决三类问题：
//
//  1. 块内插值：顶部落在长代码块/折行段落内部时按段内比例继续映射，
//     而不是回落到块首（块越长偏差越大）；
//  2. 块间空隙：源码空行/块间距对应预览里元素间的 margin 区，段内线性
//     让两侧跨过边界时连续无跳变，且正反向互为反函数，交替微调两侧
//     不会互相追赶；
//  3. 端点对齐：两侧同一文档的渲染高度天然不同（编辑器 .cm-content 有
//     30vh 底部 padding，末段滚动期间顶部行号根本不变）。末段锚点延伸到
//     两侧内容底边，再加末段线性靠拢：一边滚到底时另一边也恰好到底。
//
// 程序写入 scrollTop 引发的回声滚动事件按"写入值比对"识别（事件值与最近
// 一次写入一致即回声，直接忽略）。scroll 事件经 rAF 合帧。
//
// 坐标换算依据 CodeMirror 内部约定：scrollDOM.scrollTop = 文档相对高度 +
// documentPadding.top（.cm-content 的 padding-top 计入滚动区）。

const ECHO_EPS = 1.5; // px：事件 scrollTop 与写入值之差在此内视为回声
const ECHO_TTL = 150; // ms：写入记录保鲜期，防止残留记录误吞真实滚动

let cm = null;
let preview = null;
let editorRaf = 0;
let previewRaf = 0;

// 最近一次程序写入的 scrollTop（回声识别依据）
let editorWrite = null;
let previewWrite = null;

/** data-line 锚点：0 基源码行 + 元素顶边的视口坐标。 */
// { line, top }

/** 分段线性映射的一段：e 为编辑区文档相对像素，p 为预览内容偏移。 */
// { e0, e1, p0, p1 }

export function registerSplitEditor(view) {
  cm = view;
  editorWrite = null;
}

export function registerSplitPreview(el) {
  preview = el;
  previewWrite = null;
}

/** 编辑区滚动（分屏模式）：回声事件直接忽略，真实滚动驱动预览区跟随。 */
export function onEditorScrolled() {
  if (isEcho("editor")) return;
  if (editorRaf) return;
  editorRaf = requestAnimationFrame(() => {
    editorRaf = 0;
    syncPreviewFromEditor();
  });
}

/** 预览区滚动（分屏模式）：回声事件直接忽略，真实滚动驱动编辑区跟随。 */
export function onPreviewScrolled() {
  if (isEcho("preview")) return;
  if (previewRaf) return;
  previewRaf = requestAnimationFrame(() => {
    previewRaf = 0;
    syncEditorFromPreview();
  });
}

// ===== 回声识别与写入记录 =====

function isEcho(side) {
  const record = side === "editor" ? editorWrite : previewWrite;
  const el = side === "editor" ? cm?.scrollDOM : preview;
  if (!record || !el) return false;
  if (performance.now() - record.at > ECHO_TTL) {
    clearWrite(side);
    return false;
  }
  if (Math.abs(el.scrollTop - record.top) <= ECHO_EPS) {
    // 消费掉这次写入：记录残留时同值的后续用户事件不再被误吞
    clearWrite(side);
    return true;
  }
  return false;
}

function clearWrite(side) {
  if (side === "editor") editorWrite = null;
  else previewWrite = null;
}

/** 程序写入 scrollTop 之后记录实际生效值（浏览器/CM 可能收敛取整）。 */
function recordWrite(side) {
  if (side === "editor") {
    if (!cm) return;
    editorWrite = { top: cm.scrollDOM.scrollTop, at: performance.now() };
  } else {
    if (!preview) return;
    previewWrite = { top: preview.scrollTop, at: performance.now() };
  }
}

// ===== 坐标与分段工具 =====

/** 编辑器内容区底边（文档相对像素，不含 .cm-content padding）。 */
function editorContentBottom(view) {
  const last = view.state.doc.line(view.state.doc.lines);
  const block = view.lineBlockAt(last.from);
  return block.top + block.height;
}

/** 0 基行号 line0 所在行块的文档相对 top；超出文档末时取内容底边。 */
function blockTopOfLine(view, line0) {
  const doc = view.state.doc;
  if (line0 >= doc.lines) return editorContentBottom(view);
  return view.lineBlockAt(doc.line(line0 + 1).from).top;
}

/** 预览区内全部 data-line 锚点（文档序，含元素顶边视口坐标）。 */
function collectAnchors(root) {
  const out = [];
  for (const el of root.querySelectorAll("[data-line]")) {
    const line = Number(el.getAttribute("data-line"));
    if (!Number.isFinite(line)) continue;
    out.push({ line, top: el.getBoundingClientRect().top });
  }
  return out;
}

/**
 * 构建分段线性映射表。每个锚点产生一个点（编辑区文档相对像素 ⇄ 预览内
 * 容偏移）；行号相同（嵌套容器）或坐标不前进的锚点跳过，避免零长度段。
 * 首尾各补一个端点：编辑区文档顶/内容底 ⇄ 预览滚动顶/内容底，让引导区
 * 与末段也有连续映射、两端点天然对齐。
 */
function buildSegments(anchors, view, previewEl) {
  const contTop = previewEl.getBoundingClientRect().top;
  const scrollTop = previewEl.scrollTop;
  const pts = [{ e: 0, p: 0 }];
  for (const a of anchors) {
    const e = blockTopOfLine(view, a.line);
    const p = a.top - contTop + scrollTop;
    const last = pts[pts.length - 1];
    if (e <= last.e + 0.5 || p <= last.p + 0.5) continue;
    pts.push({ e, p });
  }
  const eEnd = editorContentBottom(view);
  const padBottom = parseFloat(getComputedStyle(previewEl).paddingBottom) || 0;
  const pEnd = previewEl.scrollHeight - padBottom;
  const last = pts[pts.length - 1];
  if (eEnd > last.e + 0.5 && pEnd > last.p + 0.5) pts.push({ e: eEnd, p: pEnd });

  const segs = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    segs.push({ e0: pts[i].e, e1: pts[i + 1].e, p0: pts[i].p, p1: pts[i + 1].p });
  }
  return segs;
}

/** 编辑区文档相对像素 y → 预览内容偏移（段内线性插值，越界取端点）。 */
function previewAt(segs, y) {
  if (y <= segs[0].e0) return segs[0].p0;
  const last = segs[segs.length - 1];
  if (y >= last.e1) return last.p1;
  for (const s of segs) {
    if (y <= s.e1) return s.p0 + ((y - s.e0) / (s.e1 - s.e0)) * (s.p1 - s.p0);
  }
  return last.p1;
}

/** 预览内容偏移 p → 编辑区文档相对像素（previewAt 的反函数）。 */
function editorAt(segs, p) {
  if (p <= segs[0].p0) return segs[0].e0;
  const last = segs[segs.length - 1];
  if (p >= last.p1) return last.e1;
  for (const s of segs) {
    if (p <= s.p1) return s.e0 + ((p - s.p0) / (s.p1 - s.p0)) * (s.e1 - s.e0);
  }
  return last.e1;
}

/** 编辑区末段（30vh 底部 padding 区）起点对应的 scrollTop。 */
function editorTailStart(view, contentBottom) {
  return Math.max(0, view.documentPadding.top + contentBottom - view.scrollDOM.clientHeight);
}

// ===== 编辑区 → 预览区 =====

/**
 * 把预览区对齐到编辑区顶部可见源码位置。顶部落在某锚点段内时按段内
 * 比例线性映射；编辑区滚进末段（内容底边贴住视口底边后，剩余滚动只有
 * 30vh padding）后目标位置向预览区底部线性收敛，编辑区到底时预览区恰好
 * 到底。进入分屏时的初始对齐与内容变化后的跟随也直接调用本函数。
 */
export function syncPreviewFromEditor() {
  if (!cm || !preview) return;
  const scroller = cm.scrollDOM;
  const maxE = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const maxP = Math.max(0, preview.scrollHeight - preview.clientHeight);

  // 编辑区在文档起点（或不可滚动）：预览区对齐到自身滚动起点
  if (scroller.scrollTop <= 0 || maxE <= 0) {
    preview.scrollTop = 0;
    recordWrite("preview");
    return;
  }

  const contentBottom = editorContentBottom(cm);
  const y = Math.min(scroller.scrollTop - cm.documentPadding.top, Math.max(0, contentBottom - 1));
  const segs = buildSegments(collectAnchors(preview), cm, preview);

  let target;
  if (segs.length === 0) {
    // 无锚点（纯 HTML 文档等）：退化为两侧可滚动比例映射
    target = (scroller.scrollTop / maxE) * maxP;
  } else {
    target = previewAt(segs, y);
    // 末段线性靠拢：scrollTop 越过 tailStart 后把目标位置拉向预览区底部
    const tailStart = editorTailStart(cm, contentBottom);
    if (maxE > tailStart && maxP > 0) {
      const k = Math.min(1, Math.max(0, (scroller.scrollTop - tailStart) / (maxE - tailStart)));
      if (k > 0) target += (maxP - target) * k;
    }
  }

  preview.scrollTop = Math.min(Math.max(0, target), maxP);
  recordWrite("preview");
}

// ===== 预览区 → 编辑区 =====

/**
 * 让编辑区跟随预览区顶部：预览顶端位置经分段线性映射反求编辑区位置。
 * 先反演正向的末段拉力（保证两侧交替微调时往返一致、不互相追赶），
 * 再对预览区自身末段（内容底边贴住视口底边后）向编辑区底部线性收敛，
 * 预览区到底时编辑区恰好到底。
 */
export function syncEditorFromPreview() {
  if (!cm || !preview) return;
  const scroller = cm.scrollDOM;
  const maxE = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const maxP = Math.max(0, preview.scrollHeight - preview.clientHeight);
  const contentBottom = editorContentBottom(cm);
  const segs = buildSegments(collectAnchors(preview), cm, preview);

  let target;
  if (segs.length === 0) {
    // 无锚点：两侧可滚动比例映射
    target = maxP > 0 ? (preview.scrollTop / maxP) * maxE : 0;
  } else {
    const p = preview.scrollTop;
    const padTop = cm.documentPadding.top;
    // scrollTop ⇄ 预览内容偏移 的线性换算（editorAt 返回文档相对坐标）
    const inv = (pv) => editorAt(segs, Math.min(Math.max(0, pv), segs[segs.length - 1].p1)) + padTop;
    target = inv(p);
    // 反演正向末段拉力：正向映射为 a + (maxP - a)·k，反求 a 对应的编辑
    // 区位置；k 随 target 变化很慢，定点迭代两轮足够
    const tailStart = editorTailStart(cm, contentBottom);
    if (maxE > tailStart && maxP > 0) {
      for (let i = 0; i < 2; i++) {
        const k = (target - tailStart) / (maxE - tailStart);
        if (k <= 0) break;
        if (k >= 0.98) {
          target = maxE;
          break;
        }
        const a = (p - maxP * k) / (1 - k);
        target = inv(a);
      }
    }
    // 预览区末段（剩余滚动只有容器 padding-bottom）向编辑区底部收敛
    const padBottom = parseFloat(getComputedStyle(preview).paddingBottom) || 0;
    const tailStartP = Math.max(0, preview.scrollHeight - padBottom - preview.clientHeight);
    if (maxP > tailStartP && maxE > 0) {
      const k = Math.min(1, Math.max(0, (preview.scrollTop - tailStartP) / (maxP - tailStartP)));
      if (k > 0) target += (maxE - target) * k;
    }
  }

  scroller.scrollTop = Math.min(Math.max(0, target), maxE);
  recordWrite("editor");
}

// 自动化测试钩子：后台 webview（无头/隐藏标签）会节流 rAF 且不派发
// scroll 事件，事件路径无法端到端验证。测试桩在页面加载前设置
// window.__HI_SPLIT_TEST__ 时暴露同步函数供直接调用（生产环境无副作用）。
if (typeof window !== "undefined" && window.__HI_SPLIT_TEST__) {
  window.__hiSplit = { syncPreviewFromEditor, syncEditorFromPreview };
}
