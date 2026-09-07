// 设置页（UI-5.8）：左导航 + 右内容，含插件管理（FR-18.3 开关写回 config.json）

import { state } from "./state.js";
import { showDialog } from "./ui.js";
import { ICONS } from "./icons.js";
import { t } from "./i18n.js";
import { setLanguage as i18nSetLanguage, applyI18n } from "./i18n.js";
import { applyTheme } from "./theme.js";

const invoke = (...args) => window.__TAURI__.core.invoke(...args);

const CATEGORIES = [
  { id: "appearance", label: t("settings.cat.appearance") },
  { id: "editor", label: t("settings.cat.editor") },
  { id: "file", label: t("settings.cat.file") },
  { id: "markdown", label: "Markdown" },
  { id: "session", label: t("settings.cat.session") },
  { id: "plugins", label: t("settings.cat.plugins") },
  { id: "about", label: t("settings.cat.about") },
];

let current = "appearance"; // 每次进设置的默认分类（外观 = 主题风格）

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
  back.title = t("settings.back");
  back.addEventListener("click", closeSettings);
  const title = document.createElement("div");
  title.className = "settings-title";
  title.textContent = t("settings.title");
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
    showDialog({ title: t("settings.saveFailed"), body: String(e) })
  );
}

function renderSettingsItems(panel, category) {
  const s = state.settings;
  const map = {
    appearance: [
      item(
        { label: t("settings.uiLang"), desc: t("settings.uiLang.desc") },
        selectControl(
          s.language || "auto",
          [
            ["auto", t("settings.uiLang.auto")],
            ["zh-CN", "简体中文"],
            ["en-US", "English"],
          ],
          (v) => {
            s.language = v;
            persist();
            i18nSetLanguage(v);
            applyI18n();
            render();
          }
        )
      ),
      item(
        { label: t("settings.theme"), desc: t("settings.theme.desc") },
        selectControl(
          s.theme || "light",
          [
            ["light", t("settings.theme.light")],
            ["dark", t("settings.theme.dark")],
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
      item({ label: t("settings.fontSize"), desc: t("settings.fontSize.desc") }, numberControl(s.font_size, 8, 72, (v) => { s.font_size = v; persist(); })),
      item({ label: t("settings.formatIndent"), desc: t("settings.formatIndent.desc") }, numberControl(s.format_indent, 0, 8, (v) => { s.format_indent = v; persist(); })),
    ],
    file: [
      item({ label: t("settings.defaultEol") }, selectControl(s.default_eol, [["crlf", "Windows (CRLF)"], ["lf", "Unix (LF)"]], (v) => { s.default_eol = v; persist(); })),
      item({ label: t("settings.defaultEncoding") }, selectControl(s.default_encoding, state.registry.encodings, (v) => { s.default_encoding = v; persist(); })),
      item({ label: t("settings.largeFileMB") }, numberControl(s.large_file_mb, 1, 512, (v) => { s.large_file_mb = v; persist(); })),
      item({ label: t("settings.newTabLang") }, selectControl(s.new_tab_language, [["plaintext", t("settings.newTabLang.plain")], ["markdown", "Markdown"]], (v) => { s.new_tab_language = v; persist(); })),
    ],
    markdown: [
      item({ label: t("settings.mdMode"), desc: t("settings.mdMode.desc") }, selectControl(s.markdown_mode, [["wysiwyg", t("settings.mdMode.wysiwyg")], ["source", t("settings.mdMode.source")]], (v) => { s.markdown_mode = v; persist(); })),
    ],
    session: [
      item({ label: t("settings.restoreSession"), desc: t("settings.restoreSession.desc") }, switchControl(s.restore_session, (v) => { s.restore_session = v; persist(); })),
      item({ label: t("settings.confirmClose"), desc: t("settings.confirmClose.desc") }, switchControl(s.confirm_close, (v) => { s.confirm_close = v; persist(); })),
    ],
    about: [],
  };
  for (const row of map[category] || []) panel.appendChild(row);
  if (category === "about") {
    const info = document.createElement("div");
    info.style.cssText = "font-size:13px;color:var(--text-secondary);line-height:2";
    info.textContent = "HiEditor 0.1.0 — " + t("about.desc");
    panel.appendChild(info);
  }
  if (category === "about") renderAbout(panel);
}

async function renderPlugins(panel) {
  const rows = document.createElement("div");
  try {
    state.plugins = await invoke("get_plugins");
  } catch (e) {
    showDialog({ title: t("plugins.loadFailed"), body: String(e) });
    return;
  }
  const stateLabel = { loaded: t("plugins.state.loaded"), disabled: t("plugins.state.disabled"), failed: t("plugins.state.failed") };
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
          title: t("plugins.toggleTitle"),
          body: t("plugins.toggleBody"),
        });
      } catch (e) {
        showDialog({ title: t("dialog.writeFailed"), body: String(e) });
      }
    });
    row.append(info, badge, sw);
    rows.appendChild(row);
  }
  panel.appendChild(
    item(
      { label: t("plugins.discovered"), desc: t("plugins.discovered.desc", { n: state.plugins.length }) },
      document.createElement("span")
    )
  );
  panel.appendChild(rows);
}

// ===== 关于页扩展信息（开源地址 / 作者微信） =====

const ABOUT = {
  repo: "https://github.com/hicode0101/HiEditor",
  wechatId: "hicode0101",
  wechatDisplay: "hicode0101（犀利的远哥）",
};

function miniBtn(label, action) {
  const b = document.createElement("button");
  b.className = "link-btn";
  b.textContent = label;
  b.addEventListener("click", action);
  return b;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    const { showBanner } = await import("./ui.js");
    showBanner({ message: t("about.copied"), info: true, autoHideMs: 1500 });
  } catch (e) {
    showDialog({ title: t("dialog.copyFailed"), body: String(e) });
  }
}

function renderAbout(panel) {
  const repoActions = document.createElement("span");
  repoActions.style.cssText = "display:flex;gap:8px";
  repoActions.append(
    miniBtn(t("about.open"), () =>
      invoke("open_url", { url: ABOUT.repo }).catch((e) =>
        showDialog({ title: t("dialog.openError"), body: String(e) })
      )
    ),
    miniBtn(t("about.copy"), () => copyText(ABOUT.repo))
  );
  panel.appendChild(item({ label: t("about.source"), desc: ABOUT.repo }, repoActions));

  panel.appendChild(
    item(
      { label: t("about.wechat"), desc: ABOUT.wechatDisplay },
      miniBtn(t("about.copyWechat"), () => copyText(ABOUT.wechatId))
    )
  );
}
