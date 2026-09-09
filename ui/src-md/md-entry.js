// Markdown 渲染入口（marked，经 esbuild 打包为 ui/vendor/md.js 供主代码动态 import）
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: false });

export function renderMarkdown(text) {
  return marked.parse(text ?? "");
}
