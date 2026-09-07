// 会话持久化（FR-10）：未保存内容防抖写盘 + 30 秒兜底，崩溃/强杀后可恢复。
// 缓冲区始终是源文本；无路径或已脏的标签连文本一起存，干净的有路径标签只存路径。

import { state } from "./state.js";
import { persistActiveFromEditor } from "./editor.js";

const invoke = (...args) => window.__TAURI__.core.invoke(...args);

let timer = null;
let lastWritten = "";

export function tabSessionData(tab) {
  const includeText = tab.dirty || !tab.path;
  const d = {
    title: tab.title,
    path: tab.path,
    dirty: tab.dirty,
    encoding: tab.encoding,
    eol: tab.eol,
    lang: tab.lang,
    mode: tab.mode,
    zoom: tab.zoom,
    scroll: tab.scroll,
    cursor: tab.cursor,
  };
  if (includeText) d.text = tab.text;
  return d;
}

export function collectSession() {
  persistActiveFromEditor();
  return {
    version: 1,
    savedAt: Date.now(),
    activeIndex: state.tabs.findIndex((t) => t.id === state.activeId),
    tabs: state.tabs.map(tabSessionData),
  };
}

export function scheduleSessionSave() {
  clearTimeout(timer);
  timer = setTimeout(flushSession, 1200);
}

export async function flushSession() {
  try {
    const s = JSON.stringify(collectSession());
    if (s === lastWritten) return; // 无变化不写盘
    lastWritten = s;
    await invoke("save_session", { session: JSON.parse(s) });
  } catch (e) {
    // 会话写盘失败不打扰用户（FR-18.5 隔离原则），下次防抖重试
  }
}
