// 浏览器标签（v1.9）：iframe 内嵌网页视图 + 前进 / 后退 / 地址栏 / F5 刷新。
// 标签类型 lang = "browser"，与 pdf 一样走独立视图（main.js syncContentView 统一仲裁）。
// 页面内的新窗口请求（target=_blank、window.open）由 Rust 壳的 on_new_window 拦截，
// 经 "browser-open-url" 事件转发到这里强制新开浏览器选项卡（见 main.rs setup）。
// 注意：Markdown 预览的超链接不走这里，点击直接调用系统默认浏览器（openLinkFromPreview）。
//
// 已知边界（同源策略，VS Code Simple Browser 同样如此）：
// - 跨源 iframe 无法回读真实地址 / 标题，也无法感知页内链接点击导致的跳转；
//   前进 / 后退基于本模块自维护的导航栈（地址栏回车、程序化打开），
//   页内点击后的地址栏显示停留在最后一次受控导航的地址。
// - 部分站点通过 X-Frame-Options / CSP frame-ancestors 拒绝被内嵌，iframe 内会
//   原样显示浏览器拒绝提示，属目标站点的安全策略，非本应用可绕过。

import { state, activeTab, newTabModel } from "./state.js";
import { switchTab } from "./files.js";
import { t } from "./i18n.js";
import { APP_NAME } from "./constants.js";

const invoke = (...args) => window.__TAURI__.core.invoke(...args);

// 每个浏览器标签一个常驻 iframe（tabId → HTMLIFrameElement）：切换标签时显隐而非
// 销毁重建，保留各标签的页面状态（滚动位置、表单输入、登录态随 WebView2 会话保留）。
const frames = new Map();

export function isBrowserTab(tab) {
  return !!(tab && tab.lang === "browser");
}

// 是否显式带 URL 协议（排除 Windows 盘符 "C:\..." 被误判为 scheme "c:"）
function hasScheme(input) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input) && !/^[a-zA-Z]:[\\/]/.test(input);
}

// 本地文件路径 → asset 协议 URL（assetProtocol 在 tauri.conf.json 启用后可用）
export function fileSrcUrl(path) {
  const conv = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.convertFileSrc;
  return conv ? conv(path) : "file:///" + String(path).replace(/^\/+/, "");
}

// 路径规范化：统一分隔符、消化 ./ 与 ../（md 相对链接解析用）
function normalizePath(p) {
  const s = String(p).replace(/\\/g, "/");
  const prefix = /^[a-zA-Z]:\//.test(s) ? s.slice(0, 3) : s.startsWith("/") ? "/" : "";
  const out = [];
  for (const seg of s.slice(prefix.length).split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === ".." && out.length && out[out.length - 1] !== "..") out.pop();
    else out.push(seg);
  }
  return prefix + out.join("/");
}

// 地址栏输入 → 可加载 URL：补协议、本地路径转 asset 协议
export function normalizeUrl(raw) {
  const input = String(raw || "").trim();
  if (!input) return "";
  if (/^https?:\/\//i.test(input)) return input;
  if (/^(file|asset|data|blob|about):/i.test(input)) return input;
  if (/^[a-zA-Z]:[\\/]/.test(input)) return fileSrcUrl(input); // Windows 本地路径
  if (/^\/(?!\/)/.test(input)) return fileSrcUrl(input); // POSIX 绝对路径
  // localhost / IP 地址必须先于 hasScheme 判断（否则 "localhost:" 会被当成协议），
  // 强制 http 以贴合本机开发服务器场景
  const isLocalHost =
    /^(localhost|\[::1\]|127\.\d+\.\d+\.\d+)(:\d+)?([/?#].*)?$/i.test(input) ||
    /^(?:\d{1,3}\.){3}\d{1,3}(:\d+)?([/?#].*)?$/.test(input);
  if (isLocalHost) return "http://" + input;
  if (hasScheme(input)) return input; // 其它协议交由 WebView 自行处理
  return "https://" + input;
}

// 由 URL 推导标签标题：网页取主机名，asset 本地文件取文件名
function titleForUrl(url) {
  try {
    const u = new URL(url);
    if (/^asset:?$/i.test(u.protocol) || u.hostname === "asset.localhost") {
      const p = decodeURIComponent(u.pathname || "");
      return p.split(/[\\/]/).filter(Boolean).pop() || u.hostname || url;
    }
    return u.hostname || url;
  } catch {
    return url;
  }
}

function setTabTitle(tab, title) {
  tab.title = title;
  if (tab.id === state.activeId) document.title = `${title} - ${APP_NAME}`;
  window.dispatchEvent(new CustomEvent("tabs-refresh"));
}

// 新建浏览器标签；url 为空 = 空白起始页（等地址栏输入）。会话恢复走 activate=false。
export function newBrowserTab(url, { activate = true } = {}) {
  const tab = newTabModel({ lang: "browser", title: t("browser.newTab") });
  tab.text = "";
  tab.url = "";
  tab.history = [];
  tab.historyIndex = -1;
  state.tabs.push(tab);
  if (url) navigate(tab, url);
  if (activate) {
    switchTab(tab.id);
    if (!url) setTimeout(() => document.getElementById("browser-url")?.focus(), 0);
  } else {
    window.dispatchEvent(new CustomEvent("tabs-refresh"));
  }
  window.dispatchEvent(new CustomEvent("tab-updated", { detail: tab.id }));
  return tab;
}

// 受控导航：push=true 时截断前进栈并压入新地址；回放（前进/后退/刷新）用 push=false
export function navigate(tab, url, { push = true } = {}) {
  if (!isBrowserTab(tab)) return;
  const target = normalizeUrl(url);
  if (!target) return;
  if (push) {
    tab.history = tab.history.slice(0, tab.historyIndex + 1);
    tab.history.push(target);
    tab.historyIndex = tab.history.length - 1;
  }
  tab.url = target;
  ensureFrame(tab).src = target; // 同值重新赋值 src 同样触发重新加载（刷新 / 回车共用）
  setTabTitle(tab, titleForUrl(target));
  syncBrowserBar(tab);
}

export function browserBack() {
  const tab = activeTab();
  if (!isBrowserTab(tab) || tab.historyIndex <= 0) return;
  tab.historyIndex -= 1;
  navigate(tab, tab.history[tab.historyIndex], { push: false });
}

export function browserForward() {
  const tab = activeTab();
  if (!isBrowserTab(tab) || tab.historyIndex >= tab.history.length - 1) return;
  tab.historyIndex += 1;
  navigate(tab, tab.history[tab.historyIndex], { push: false });
}

// F5 / 刷新按钮：重设当前地址触发重新加载
export function browserReload() {
  const tab = activeTab();
  if (!isBrowserTab(tab) || !tab.url) return;
  navigate(tab, tab.url, { push: false });
}

function ensureFrame(tab) {
  let frame = frames.get(tab.id);
  if (!frame) {
    frame = document.createElement("iframe");
    frame.className = "browser-frame";
    frames.set(tab.id, frame);
    document.getElementById("browser-view").appendChild(frame);
  }
  return frame;
}

// 回收已关闭标签的 iframe
function pruneFrames() {
  for (const [id, frame] of [...frames]) {
    if (!state.tabs.some((x) => x.id === id)) {
      frame.remove();
      frames.delete(id);
    }
  }
}

// 激活当前浏览器标签的视图（syncContentView 在切到 browser 标签时调用）
export function renderBrowserTab() {
  const tab = activeTab();
  if (!isBrowserTab(tab)) return;
  pruneFrames();
  for (const [id, frame] of frames) {
    frame.style.display = id === tab.id ? "" : "none";
  }
  const frame = ensureFrame(tab);
  frame.style.display = "";
  if (!tab.url && !frame.getAttribute("src")) frame.src = "about:blank";
  syncBrowserBar(tab);
}

// 地址栏与前进/后退按钮状态同步（输入中的地址不被覆盖）
export function syncBrowserBar(tab) {
  if (!isBrowserTab(tab) || activeTab() !== tab) return;
  const input = document.getElementById("browser-url");
  if (input && document.activeElement !== input) input.value = tab.url || "";
  const back = document.getElementById("browser-back");
  const fwd = document.getElementById("browser-forward");
  if (back) back.disabled = !(tab.historyIndex > 0);
  if (fwd) fwd.disabled = !(tab.historyIndex >= 0 && tab.historyIndex < tab.history.length - 1);
}

// md 预览超链接入口：点击一律调用系统默认浏览器打开（v1.9 调整：不再新开应用内浏览器
// 选项卡）。返回 false = 交给默认行为（页内锚点 #... 在预览内跳转）。
// - http/https / mailto / tel：open_url 交系统默认处理程序
// - 相对链接：解析到 md 所在目录的本地文件，转 file:/// URL 交系统（.html/.htm 的
//   默认关联即默认浏览器；open_url 的白名单含 file:///）
// - 其它协议（data:/blob:/自定义）：open_url 白名单会拒绝，静默忽略
export function openLinkFromPreview(href, tab) {
  const raw = String(href || "").trim();
  if (!raw || raw.startsWith("#")) return false;
  if (/^(https?|mailto|tel):/i.test(raw)) {
    invoke("open_url", { url: raw }).catch(() => {});
    return true;
  }
  if (hasScheme(raw)) {
    invoke("open_url", { url: raw }).catch(() => {}); // 非 web 协议由 Rust 白名单拒绝
    return true;
  }
  // 相对链接：解析到 md 所在目录下的本地文件
  const dir = tab && tab.path ? tab.path.replace(/[\\/][^\\/]*$/, "").replace(/\\/g, "/") : "";
  if (!dir) {
    import("./ui.js")
      .then(({ showBanner }) =>
        showBanner({ message: t("browser.relLinkUnsaved"), info: true, autoHideMs: 3000 })
      )
      .catch(() => {});
    return true;
  }
  let rel = raw;
  try {
    rel = decodeURIComponent(raw);
  } catch {
    /* 保留原文 */
  }
  const abs = /^[a-zA-Z]:[\\/]/.test(rel) || /^[/\\]/.test(rel)
    ? normalizePath(rel)
    : normalizePath(dir + "/" + rel.replace(/\\/g, "/"));
  // 逐段 encode（处理空格 / 中文 / #），file:/// 后盘符形如 D%3A，由 open_url 解码还原
  const enc = abs.split("/").map(encodeURIComponent).join("/");
  invoke("open_url", { url: enc.startsWith("/") ? "file://" + enc : "file:///" + enc }).catch(() => {});
  return true;
}

export function initBrowserViewer() {
  document.getElementById("browser-back").addEventListener("click", browserBack);
  document.getElementById("browser-forward").addEventListener("click", browserForward);
  document.getElementById("browser-reload").addEventListener("click", browserReload);
  const input = document.getElementById("browser-url");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const tab = activeTab();
      if (isBrowserTab(tab)) navigate(tab, input.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      syncBrowserBar(activeTab()); // 放弃编辑，回显当前地址
      input.blur();
    }
  });
  input.addEventListener("focus", () => input.select());
  input.addEventListener("blur", () => syncBrowserBar(activeTab()));
  window.addEventListener("tabs-refresh", pruneFrames);
  // Rust 壳转发的新窗口请求（target=_blank / window.open，含 iframe 内）：
  // 强制新开浏览器选项卡；Rust 侧已限 http/https（v1.9）
  try {
    window.__TAURI__.event.listen("browser-open-url", (e) => {
      const url = e.payload;
      if (typeof url === "string" && /^https?:\/\//i.test(url)) newBrowserTab(url);
    });
  } catch (e) {
    /* 事件 API 不可用（如纯浏览器环境）时忽略 */
  }
}
