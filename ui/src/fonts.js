// 字体清单单一来源：工具栏"字体"下拉与设置页"默认字体"共用，避免两处硬编码漏改。
// 静态列表覆盖常见系统字体；fonts/ 目录的用户字体（family = "uf-<名称>"）由 main.js
// 注入 @font-face 后挂在 window.__userFonts，这里只负责读取。

export const STATIC_FONTS = [
  ["Cascadia Mono", "Cascadia Mono"],
  ["Consolas", "Consolas"],
  ["Courier New", "Courier New"],
  ["SimSun", "宋体 SimSun"],
  ["Microsoft YaHei", "微软雅黑"],
  ["Arial", "Arial"],
];

// 首项为空值 = 跟随系统默认字体
export function fontOptions(systemLabel) {
  const user = (window.__userFonts || []).map((f) => ["uf-" + f.name, f.name]);
  return [["", systemLabel], ...STATIC_FONTS, ...user];
}
