// 内联 SVG 图标集（文档 4.6：Fluent 线性风格，1.5px 描边，16×16）

const S = (inner, vb = "0 0 16 16") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

export const ICONS = {
  app: S(
    `<rect x="3" y="1.5" width="10" height="13" rx="1.5" fill="#fff" stroke="#4a7ab5"/><path d="M3 4.5 h10" stroke="#4a7ab5"/><path d="M5 7 h6 M5 9.5 h6 M5 12 h4" stroke="#9ab8d8"/>`
  ),
  plus: S(`<path d="M8 3v10M3 8h10"/>`),
  close: S(`<path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/>`),
  closeSm: S(`<path d="M4 4l8 8M12 4l-8 8"/>`, "0 0 16 16"),
  minimize: S(`<path d="M2 8h12"/>`),
  maximize: S(`<rect x="2.5" y="2.5" width="11" height="11" rx="1"/>`),
  restore: S(`<rect x="2.5" y="5" width="8.5" height="8.5" rx="1"/><path d="M5 5V3.5A1 1 0 0 1 6 2.5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H11"/>`),
  chevDown: S(`<path d="M4 6.5 L8 10.5 L12 6.5"/>`),
  listBullet: S(`<path d="M5.5 4h8M5.5 8h8M5.5 12h8"/><circle cx="2.6" cy="4" r="0.9" fill="currentColor" stroke="none"/><circle cx="2.6" cy="8" r="0.9" fill="currentColor" stroke="none"/><circle cx="2.6" cy="12" r="0.9" fill="currentColor" stroke="none"/>`),
  listOl: S(`<path d="M5.5 4h8M5.5 8h8M5.5 12h8"/><path d="M2 2.8 L3 2.3 V5" stroke-width="0.9"/><text x="1.4" y="9.6" font-size="4.4" fill="currentColor" stroke="none" font-family="serif">2</text><text x="1.4" y="13.8" font-size="4.4" fill="currentColor" stroke="none" font-family="serif">3</text>`),
  task: S(`<rect x="3" y="3" width="10" height="10" rx="1.5"/>`),
  taskChecked: S(`<rect x="3" y="3" width="10" height="10" rx="1.5"/><path d="M5.5 8l2 2 3.5-4"/>`),
  link: S(`<path d="M6.5 9.5l3-3"/><path d="M7 5l1.3-1.3a2.5 2.5 0 0 1 3.5 3.5L10.5 8.5"/><path d="M9 11l-1.3 1.3a2.5 2.5 0 0 1-3.5-3.5L5.5 7.5"/>`),
  image: S(`<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><circle cx="6" cy="6" r="1.2"/><path d="M2.5 11l3-3 2.5 2.5 2-2 3.5 3.5"/>`),
  table: S(`<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M2.5 6h11M2.5 10h11M6 2.5v11M10 2.5v11"/>`),
  codeInline: S(`<path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5"/>`),
  codeBlock: S(`<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 5.5h12"/><path d="M5 8.5L3.5 10 5 11.5M8 8.5L9.5 10 8 11.5"/>`),
  eraser: S(`<path d="M6 13L2.8 9.8a1.5 1.5 0 0 1 0-2.1l5-5a1.5 1.5 0 0 1 2.1 0l3.4 3.4a1.5 1.5 0 0 1 0 2.1L8 13H6z"/><path d="M5 6.5l4.5 4.5M4 13h9"/>`),
  hr: S(`<path d="M2.5 8h11"/>`),
  readAloud: S(`<path d="M2.5 6v4h2.5L9 13V3L5 6H2.5z"/><path d="M11.5 5.5a3.5 3.5 0 0 1 0 5"/>`),
  settings: S(
    // 经典齿轮（Lucide settings 造型，24 基准缩放至 16；stroke-width 1.95×(16/24)≈1.3 与图标集一致）
    `<path stroke-width="1.95" d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle stroke-width="1.95" cx="12" cy="12" r="3"/>`,
    "0 0 24 24"
  ),
  formatToggle: S(`<path d="M3 12L6.5 3.5h.8L11 12"/><path d="M4.4 9h5"/><rect x="10" y="9.5" width="4" height="4.5" rx="0.8" fill="#f9f9f9" stroke-width="1"/><path d="M11 11.5l1 1 1.5-1.8" stroke-width="1"/>`),
  flask: S(`<path d="M6.5 2.5h3M7 2.5v4L3.5 12a1.5 1.5 0 0 0 1.3 2.2h6.4A1.5 1.5 0 0 0 12.5 12L9 6.5v-4"/><path d="M5.5 10.5h5"/>`),
  flowchart: S(`<rect x="5.5" y="2" width="5" height="3.5" rx="0.8"/><rect x="2" y="10.5" width="5" height="3.5" rx="0.8"/><rect x="9" y="10.5" width="5" height="3.5" rx="0.8"/><path d="M8 5.5v2.5M4.5 10.5V8h7v2.5"/>`),
  timeline: S(`<path d="M2.5 12.5h11"/><circle cx="5" cy="12.5" r="1" fill="currentColor" stroke="none"/><circle cx="11" cy="12.5" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="5" r="2.5"/><path d="M8 3.8V5l1 1"/>`),
  attachment: S(`<path d="M4 2.5h5.5L12.5 5.5V13a0.8 0.8 0 0 1-0.8 0.8H4.8A0.8 0.8 0 0 1 4 13V3.3a0.8 0.8 0 0 1 0.8-0.8z"/><path d="M9.5 2.5v3h3"/>`),
  back: S(`<path d="M10 3L5 8l5 5"/>`),
  check: S(`<path d="M3 8.5l3.5 3.5L13 5"/>`),
  // 编辑模式（FR-7.2）：所见即所得 = 眼睛（预览），源码 = 带斜杠的尖括号
  wysiwyg: S(`<path d="M1.8 8C3.2 5.2 5.4 3.7 8 3.7s4.8 1.5 6.2 4.3C12.8 10.8 10.6 12.3 8 12.3S3.2 10.8 1.8 8z"/><circle cx="8" cy="8" r="1.9"/>`),
  sourceCode: S(`<path d="M5.5 4.5L2 8l3.5 3.5"/><path d="M10.5 4.5L14 8l-3.5 3.5"/><path d="M9.2 3.5L6.8 12.5"/>`),
};

export function setIcon(el, name) {
  if (el && ICONS[name]) el.innerHTML = ICONS[name];
}
