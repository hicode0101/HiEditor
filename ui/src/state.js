// 全局状态：标签页（文档缓冲区）+ 插件注册表 + 设置（FR-1.8 每标签独立状态）

export const state = {
  tabs: [],
  activeId: null,
  seq: 1,
  registry: {
    languages: [],
    formatters: [],
    encodings: [],
    eols: [],
    markdownLoaded: false,
  },
  settings: {},
  plugins: [],
  settingsOpen: false,
};

export function activeTab() {
  return state.tabs.find((t) => t.id === state.activeId) || null;
}

export function newTabModel(init = {}) {
  return {
    id: state.seq++,
    title: init.title || i18n_t("tab.untitled"),
    path: init.path || null,
    text: init.text || "",
    dirty: init.dirty || false,
    encoding: init.encoding || "utf8",
    bom: init.bom || false,
    eol: init.eol || "crlf",
    lang: init.lang || "plaintext",
    mode: init.mode || "source", // WYSIWYG 引擎接入前以源码形态打开（FR-7.2 过渡）
    zoom: 100,
    scroll: 0,
    cursor: 0,
  };
}

export function langForPath(path) {
  if (!path) return state.settings.new_tab_language || "plaintext";
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : "";
  const hit = state.registry.languages.find((l) =>
    l.extensions.some((e) => e.toLowerCase() === ext)
  );
  return hit ? hit.id : "plaintext";
}

export function formattersFor(langId) {
  return state.registry.formatters.filter((f) => f.language === langId);
}
