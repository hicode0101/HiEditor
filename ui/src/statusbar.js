// D 区状态栏（UI-4）：实时行列/字符数，可点击段（语言/缩放/换行符/编码）

import { state, activeTab } from "./state.js";
import { openMenu } from "./ui.js";
import { updateStatus, setZoom, getZoom, persistActiveFromEditor } from "./editor.js";

const invoke = (...args) => window.__TAURI__.core.invoke(...args);

export function initStatusbar() {
  document.getElementById("st-lang").addEventListener("click", () => openMenu(document.getElementById("st-lang"), languageItems(), { align: "left" }));
  document.getElementById("st-zoom").addEventListener("click", () => openMenu(document.getElementById("st-zoom"), zoomItems()));
  document.getElementById("st-eol").addEventListener("click", () => openMenu(document.getElementById("st-eol"), eolItems()));
  document.getElementById("st-enc").addEventListener("click", () => openMenu(document.getElementById("st-enc"), encodingItems()));
}

function languageItems() {
  const tab = activeTab();
  return [
    { label: "自动检测", checked: tab && tab.langAuto !== false, disabled: !tab, action: () => setLang(autoDetect(tab)) },
    { sep: true },
    ...state.registry.languages.map((l) => ({
      label: l.name,
      checked: tab && tab.lang === l.id,
      disabled: !tab,
      action: () => setLang(l.id),
    })),
  ];
}

function autoDetect(tab) {
  if (!tab) return "plaintext";
  if (tab.path) {
    const dot = tab.path.lastIndexOf(".");
    const ext = dot >= 0 ? tab.path.slice(dot).toLowerCase() : "";
    const hit = state.registry.languages.find((l) => l.extensions.some((e) => e.toLowerCase() === ext));
    return hit ? hit.id : "plaintext";
  }
  return "plaintext";
}

function setLang(langId) {
  const tab = activeTab();
  if (!tab) return;
  tab.lang = langId;
  tab.langAuto = false;
  window.dispatchEvent(new CustomEvent("tab-switched", { detail: tab.id }));
  updateStatus();
}

function zoomItems() {
  return [
    { label: "放大", shortcut: "Ctrl+加号", action: () => window.dispatchEvent(new CustomEvent("zoom", { detail: 10 })) },
    { label: "缩小", shortcut: "Ctrl+减号", action: () => window.dispatchEvent(new CustomEvent("zoom", { detail: -10 })) },
    { label: "恢复默认缩放", shortcut: "Ctrl+0", action: () => window.dispatchEvent(new CustomEvent("zoom", { detail: 0 })) },
    { sep: true },
    { label: `${getZoom()}%（30% – 500%）`, disabled: true },
  ];
}

function eolItems() {
  return state.registry.eols.map(([key, label]) => ({
    label: `转换为 ${label}`,
    checked: activeTab() && activeTab().eol === key,
    disabled: !activeTab(),
    action: () => {
      const tab = activeTab();
      const ed = document.getElementById("editor");
      tab.eol = key;
      const v = ed.value;
      const normalized = v
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(key === "crlf" ? /\n/g : key === "cr" ? /\n/g : /\n/g, key === "crlf" ? "\r\n" : key === "cr" ? "\r" : "\n");
      ed.value = normalized;
      tab.text = normalized;
      tab.dirty = true;
      updateStatus();
    },
  }));
}

function encodingItems() {
  const tab = activeTab();
  return [
    ...state.registry.encodings.map(([key, label]) => ({
      label: `重新以此编码打开：${label}`,
      disabled: !tab || !tab.path,
      action: async () => {
        persistActiveFromEditor();
        const out = await invoke("read_file", { path: tab.path, forced: key });
        tab.text = out.text;
        tab.encoding = out.encoding;
        tab.eol = out.eol;
        document.getElementById("editor").value = out.text;
        updateStatus();
      },
    })),
    { sep: true },
    ...state.registry.encodings.map(([key, label]) => ({
      label: `以此编码保存：${label}`,
      disabled: !tab,
      action: () => {
        tab.encoding = key;
        updateStatus();
        window.dispatchEvent(new CustomEvent("request-save"));
      },
    })),
  ];
}
