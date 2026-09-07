# HiEditor

跨平台（Windows / macOS / Linux）轻量文本 / Markdown 编辑器，UI 1:1 复刻新版 Windows 记事本形态，
核心能力（Markdown 所见即所得、JSON/XML 格式化、多语言语法高亮）以**插件**形式加载。

需求文档：[docs/HiEditor-功能开发需求文档.md](docs/HiEditor-功能开发需求文档.md)
插件开发指南：[插件开发指南.md](插件开发指南.md)（config.json 字段、C ABI 契约、编译部署）

## 架构

```
crates/
├─ hi-editor-core/        # 纯 Rust 核心：编码检测 / 换行符 / 设置持久化（可单测）
├─ hi-editor-plugin/      # 插件宿主：扫描 plugins/、解析 config.json、加载动态库、扩展点
├─ hi-editor-plugin-abi/  # 插件稳定 C ABI 契约（附录 C.4）
└─ hi-editor-app/         # Tauri 2 壳：窗口、命令层
ui/                       # 前端（原生 JS + CSS，无框架；CodeMirror/Milkdown 后续接入）
plugins/                  # 内置插件：markdown / json / xml / plaintext / code
```

## 构建与运行（开发）

**一键编译（推荐）**：双击或执行 `build-release.bat` —— 自动编译 release 版、同步插件到 `plugins\*\bin\`，并可选择立即启动。

手动步骤：

```bash
# 1. 构建全部（含插件动态库）
cargo build --release

# 2. 把插件动态库同步到 plugins/<name>/bin/（Linux/macOS 用 .so/.dylib）
cp target/release/hieditor_json.dll plugins/json/bin/ && \
  cp target/release/hieditor_xml.dll plugins/xml/bin/ && \
  cp target/release/hieditor_markdown.dll plugins/markdown/bin/ && \
  cp target/release/hieditor_plaintext.dll plugins/plaintext/bin/ && \
  cp target/release/hieditor_code.dll plugins/code/bin/

# 3. 运行（指定插件目录；也可放入 exe 同级 plugins/）
HIEDITOR_PLUGINS_DIR=./plugins cargo run -p hi-editor-app --release
```

## 测试

```bash
cargo test -p hi-editor-core -p hi-editor-plugin -p hi-plugin-json -p hi-plugin-xml
```

## 插件

每个插件一个文件夹，`config.json` 声明名称、加载开关、平台入口与能力贡献；
`enabled=false` 的插件启动时被忽略。详见需求文档附录 C。
