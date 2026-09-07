// 主题（设置 ▸ 外观）：浅色 / 深色，经 <html data-theme> 切换 token 覆盖

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
}
