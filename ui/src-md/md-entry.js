// Markdown 渲染入口（marked，经 esbuild 打包为 ui/vendor/md.js 供主代码动态 import）
import { marked, Lexer, Parser } from "marked";

marked.setOptions({ gfm: true, breaks: false });

// ===== 分屏滚动同步锚点（参照 HiNote data-line 方案）=====
// 给预览 HTML 的每个块级元素标注源码起始行（0 基）为 data-line 属性，
// 供 splitSync.js 建立编辑区 ⇄ 预览区的分段线性滚动映射。
//
// HiNote 用 markdown-it 的 token.map 取行号；marked v18 已移除 token.map，
// 但顶层 token 携带 raw（源码精确切片），按 raw 内换行数累加即可还原每个
// 块的起始行。仅分屏渲染（opts.anchors）走 lexer→标注→parser 分离管线；
// 顶层 token 对象同时流经 renderer，据此条件注入，普通预览输出逐字节不变。
//
// fence/原始 HTML 块等自渲染 token 由下方 renderer 包装统一注入；无法注入
// 的（如 html 产出的任意标签）不设锚点，同步时自动落到最近的上方锚点。
const BLOCK_TAG = /^<(p|h[1-6]|pre|blockquote|ul|ol|table|hr)(?=[ >])/;
for (const name of ["heading", "paragraph", "code", "blockquote", "list", "table", "hr"]) {
  const orig = marked.Renderer.prototype[name];
  marked.Renderer.prototype[name] = function (token, ...rest) {
    const html = orig.call(this, token, ...rest);
    if (token?.__line0 == null) return html;
    return html.replace(BLOCK_TAG, `<$1 data-line="${token.__line0}"`);
  };
}

/** 顶层 token 注入 __line0（raw 累加换行数 = 该块源码起始行，0 基）。 */
function annotateLine0(tokens) {
  let line = 0;
  for (const tok of tokens) {
    tok.__line0 = line;
    line += (tok.raw.match(/\n/g) || []).length;
  }
  return tokens;
}

export function renderMarkdown(text, opts = {}) {
  if (!opts.anchors) return marked.parse(text ?? "");
  return Parser.parse(annotateLine0(Lexer.lex(text ?? "")));
}
