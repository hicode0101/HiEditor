<div align="center">

# HiEditor

**A lightweight, fast, plugin-based cross-platform text / code editor**

Clean Windows 11 Notepad-style interface with syntax highlighting for 15 languages, JSON/XML formatting, and a native C ABI plugin system.

[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)]()
[![Rust](https://img.shields.io/badge/built%20with-Rust-DEA584?logo=rust)]()
[![Tauri](https://img.shields.io/badge/Tauri%202-24C8DB?logo=tauri&logoColor=white)]()
[![i18n](https://img.shields.io/badge/i18n-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87%20%7C%20English-green)]()

[简体中文](README.md) | English

</div>

---

## Screenshots

**Main window — multi-tab / syntax highlighting / per-tab font & size**

![HiEditor main window](docs/ScreenShot/HiEditor-1.png)

**Settings — modal dialog / plugin management**

![HiEditor settings](docs/ScreenShot/HiEditor-2.png)

## ✨ Features

### Editing Experience
- 🗂️ **Multi-tab editing**: independent encoding / line endings / language / zoom per tab; session auto-restore (unsaved content survives crashes and force kills)
- 🔤 **Per-tab font & size**: independent font and size (10–36px) per tab, line height scales at 1.5×, restored when you switch back
- ↩️ **Full edit menu**: undo / redo / select all / cut / copy / paste / delete, transform to UPPERCASE / lowercase / Capitalize Each Word
- 🔍 **Find & replace**: top panel with match case / regex / whole word, wrap-around search, replace all, fully localized UI
- 🖱️ **Drag & drop to open**, **print** (Ctrl+P, supports PDF output), 30%–500% zoom, word wrap

### Languages & Highlighting
- **Syntax highlighting for 15 languages**: JSON / XML / Markdown / HTML / CSS / JavaScript / TypeScript / Python / Java / C# / C / C++ / Go / Rust / SQL / YAML / Shell / INI-TOML (auto-detected by file extension)
- **JSON / XML formatting & minification**: available from the edit menu, context menu, and shortcuts (Ctrl+Shift+J / Ctrl+Alt+J / Ctrl+Shift+L / Ctrl+Alt+L)

### Interface & Themes
- 🎨 **Light / dark themes**: dark-mode editor area uses `#2B2B2B`; all controls follow the theme
- 🌐 **UI internationalization**: Simplified Chinese / English, follows the system by default, can be forced
- 🧰 **Smart toolbar**: the default toolbar carries just font & size; plugins can declare per-language custom toolbars (e.g. the Markdown toolbar); when the window is too narrow, overflowing items collapse into a `⋯` button that expands as a wrapped panel
- ⚙️ **Modal settings dialog**: appearance / editing / files / Markdown / session / plugins / about

### Files & Encodings
- 📖 **Multiple encodings**: UTF-8 (with BOM) / UTF-16 LE/BE / **GBK / GB18030** / lossy ANSI decoding, reopen or save with a specific encoding
- ⚠️ **Tab-scoped banners**: file-state warnings (e.g. decode warnings) only appear on the tab they belong to

### Plugin Architecture
- 🧩 **Native C ABI plugins**: loaded as dynamic libraries; `config.json` declaratively contributes languages / formatter commands / custom toolbars / view controls
- 📦 **6 built-in plugins**: JSON, XML, Markdown, Notepad (plain text), TXT enhancement, code languages bundle
- 🔌 **Plugin management**: visual enable/disable in Settings, persisted to each plugin's `config.json`, effective after restart

## 🚀 Getting Started

### Download & Run
Extract the release package and run `HiEditor.exe` directly (Windows 10/11 ships with the WebView2 runtime — no extra dependencies needed).

### Build from Source

Prerequisites: [Rust](https://rustup.rs/) (MSVC toolchain)

```bash
# One-click build + release zip per platform (version / excluded plugins / output dir are configurable)
package-win-release.bat 1.0.0          # Windows (run on Windows)
./package-mac-release.sh 1.0.0         # macOS (run on macOS)
./package-linux-release.sh 1.0.0       # Linux (run on Linux/WSL)

# Or build only (main program + all plugins)
cargo build --release
```

Build output: `target/release/HiEditor.exe` + `plugins/<name>/bin/*.dll`; the release script arranges everything into a ready-to-run directory layout and compresses it into `dist/`.

**GitHub Actions auto-build**: pushing to `main` or tagging `v*` automatically builds on four platforms (Windows / Linux / macOS Intel / macOS Apple Silicon) and uploads the zips; tagging a release also creates a GitHub Release with all installers. See [.github/workflows/release.yml](.github/workflows/release.yml).

## 🧩 Plugin Development

Each plugin is a directory: a `config.json` (declaring languages, formatter commands, toolbars, etc.) plus a native dynamic library exporting a stable C ABI (`hi_plugin_meta / hi_plugin_command`, ...).

```json
{
  "id": "hieditor.json",
  "languages": [{ "id": "json", "name": "JSON", "extensions": [".json", ".jsonc"], "highlight": true }],
  "formatters": [{ "id": "json.pretty", "label": "Format JSON", "language": "json", "command": "pretty" }]
}
```

For the full ABI protocol, build and deployment instructions, see the **[Plugin Development Guide (Chinese)](插件开发指南.md)**.

## 🗺️ Roadmap

- [x] Markdown preview mode (Edit / Preview segmented toggle, GFM rendering)
- [ ] Markdown WYSIWYG editing (Milkdown, in-place editing)
- [ ] Go to line, bookmarks
- [ ] Read-only viewer mode for GB-level files
- [ ] Multi-window support

## 📄 Documentation

- [Requirements Specification (Chinese)](docs/HiEditor-功能开发需求文档.md) — full requirement baseline (UI specs / feature IDs / acceptance criteria)
- [Plugin Development Guide (Chinese)](插件开发指南.md) — build a HiEditor plugin from scratch

---

<div align="center">

**HiEditor** — a handy editor built with Rust

</div>
