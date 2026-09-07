// 设置页（UI-5.8）：左导航 + 右内容，含插件管理（FR-18.3 开关写回 config.json）

import { state } from "./state.js";
import { showDialog } from "./ui.js";
import { ICONS } from "./icons.js";
import { applyTheme } from "./theme.js";

const invoke = (...args) => window.__TAURI__.core.invoke(...args);

const CATEGORIES = [
  { id: "appearance", label: "外观" },
  { id: "editor", label: "文本编辑" },
  { id: "file", label: "文件" },
  { id: "markdown", label: "Markdown" },
  { id: "plugins", label: "插件" },
  { id: "about", label: "关于" },
];

let current = "editor";

export async function openSettings() {
  state.settingsOpen = true;
  document.getElementById("editor").hidden = true;
  const page = document.getElementById("settings-page");
  page.hidden = false;
  await render();
}

export function closeSettings() {
  state.settingsOpen = false;
  document.getElementById("settings-page").hidden = true;
  document.getElementById("editor").hidden = false;
}

async function render() {
  const page = document.getElementById("settings-page");
  page.innerHTML = "";

  const top = document.createElement("div");
  top.className = "settings-top";
  const back = document.createElement("button");
  back.className = "back-btn";
  back.innerHTML = ICONS.back;
  back.title = "返回";
  back.addEventListener("click", closeSettings);
  const title = document.createElement("div");
  title.className = "settings-title";
  title.textContent = "设置";
  top.append(back, title);

  const body = document.createElement("div");
  body.className = "settings-body";
  const nav = document.createElement("div");
  nav.className = "settings-nav";
  for (const cat of CATEGORIES) {
    const btn = document.createElement("button");
    btn.className = "settings-nav-item" + (cat.id === current ? " current" : "");
    btn.textContent = cat.label;
    btn.addEventListener("click", async () => {
      current = cat.id;
      await render();
    });
    nav.appendChild(btn);
  }
  const content = document.createElement("div");
  content.className = "settings-content";
  const panel = document.createElement("div");
  panel.className = "settings-panel";
  if (current === "plugins") await renderPlugins(panel);
  else renderSettingsItems(panel, current);
  content.appendChild(panel);

  body.append(nav, content);
  page.append(top, body);
}

function item(labels, control) {
  const row = document.createElement("div");
  row.className = "settings-item";
  const left = document.createElement("div");
  left.className = "labels";
  const label = document.createElement("div");
  label.className = "label";
  label.textContent = labels.label;
  const desc = document.createElement("div");
  desc.className = "desc";
  desc.textContent = labels.desc || "";
  left.append(label, desc);
  row.append(left, control);
  return row;
}

function selectControl(value, options, onChange) {
  const sel = document.createElement("select");
  for (const [v, label] of options) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  sel.value = value;
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

function numberControl(value, min, max, onChange) {
  const input = document.createElement("input");
  input.type = "number";
  input.min = min;
  input.max = max;
  input.value = value;
  input.addEventListener("change", () => {
    const n = Math.max(min, Math.min(max, Number(input.value) || min));
    input.value = n;
    onChange(n);
  });
  return input;
}

function switchControl(value, onChange) {
  const sw = document.createElement("button");
  sw.className = "settings-switch" + (value ? " on" : "");
  sw.addEventListener("click", () => {
    const on = !sw.classList.contains("on");
    sw.classList.toggle("on", on);
    onChange(on);
  });
  return sw;
}

function persist() {
  invoke("save_settings", { value: state.settings }).catch((e) =>
    showDialog({ title: "保存设置失败", body: String(e) })
  );
}

function renderSettingsItems(panel, category) {
  const s = state.settings;
  const map = {
    appearance: [
      item(
        { label: "主题风格", desc: "浅色 / 深色模式，切换后立即生效并记住" },
        selectControl(
          s.theme || "light",
          [
            ["light", "浅色模式"],
            ["dark", "深色模式"],
          ],
          (v) => {
            s.theme = v;
            persist();
            applyTheme(v);
          }
        )
      ),
    ],
    editor: [
      item({ label: "字号", desc: "8 – 72" }, numberControl(s.font_size, 8, 72, (v) => { s.font_size = v; persist(); })),
      item({ label: "格式化缩进（JSON/XML）", desc: "0 表示 Tab" }, numberControl(s.format_indent, 0, 8, (v) => { s.format_indent = v; persist(); })),
    ],
    file: [
      item({ label: "默认换行符" }, selectControl(s.default_eol, [["crlf", "Windows (CRLF)"], ["lf", "Unix (LF)"]], (v) => { s.default_eol = v; persist(); })),
      item({ label: "默认编码" }, selectControl(s.default_encoding, state.registry.encodings, (v) => { s.default_encoding = v; persist(); })),
      item({ label: "大文件提醒阈值 (MB)" }, numberControl(s.large_file_mb, 1, 512, (v) => { s.large_file_mb = v; persist(); })),
      item({ label: "新建标签默认语言" }, selectControl(s.new_tab_language, [["plaintext", "纯文本"], ["markdown", "Markdown"]], (v) => { s.new_tab_language = v; persist(); })),
    ],
    markdown: [
      item({ label: "默认编辑模式", desc: "所见即所得引擎在后续里程碑接入" }, selectControl(s.markdown_mode, [["wysiwyg", "所见即所得"], ["source", "源码"]], (v) => { s.markdown_mode = v; persist(); })),
    ],
    about: [],
  };
  for (const row of map[category] || []) panel.appendChild(row);
  if (category === "about") {
    const info = document.createElement("div");
    info.style.cssText = "font-size:13px;color:var(--text-secondary);line-height:2";
    info.textContent = "HiEditor 0.1.0 — 跨平台轻量文本 / Markdown 编辑器";
    panel.appendChild(info);
  }
}

async function renderPlugins(panel) {
  const rows = document.createElement("div");
  try {
    state.plugins = await invoke("get_plugins");
  } catch (e) {
    showDialog({ title: "插件列表获取失败", body: String(e) });
    return;
  }
  const stateLabel = { loaded: "已加载", disabled: "已停用", failed: "加载失败" };
  for (const p of state.plugins) {
    const row = document.createElement("div");
    row.className = "plugin-row";
    const info = document.createElement("div");
    info.className = "p-info";
    const name = document.createElement("div");
    name.className = "p-name";
    name.textContent = `${p.name}  (${p.id})`;
    const meta = document.createElement("div");
    meta.className = "p-meta";
    meta.textContent = `v${p.version} — ${p.folder}` + (p.reason ? ` — ${p.reason}` : "");
    info.append(name, meta);
    const badge = document.createElement("span");
    badge.className = "p-state" + (p.status === "failed" ? " failed" : "");
    badge.textContent = stateLabel[p.status] || p.status;
    const sw = switchControl(p.enabled, async (on) => {
      try {
        await invoke("set_plugin_enabled", { pluginId: p.id, enabled: on });
        p.enabled = on;
        showDialog({
          title: "已更新插件开关",
          body: "开关已写入插件的 config.json，重启 HiEditor 后生效。",
        });
      } catch (e) {
        showDialog({ title: "写入失败", body: String(e) });
      }
    });
    row.append(info, badge, sw);
    rows.appendChild(row);
  }
  panel.appendChild(
    item(
      { label: "已发现插件", desc: `共 ${state.plugins.length} 个；开关修改写入 config.json，重启生效` },
      document.createElement("span")
    )
  );
  panel.appendChild(rows);
}
