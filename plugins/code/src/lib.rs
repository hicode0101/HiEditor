//! 代码语言合集内置插件（FR-18.8）：HTML/CSS/JS/TS/Python/Java/C#/C/C++/Go/Rust/
//! SQL/YAML/Shell/INI-TOML/Batch 的语言与高亮贡献经 config.json 声明。

use hi_editor_plugin_abi::hi_export_plugin;

fn run(cmd: &str, _text: &str, _opts: &str) -> Result<String, String> {
    Err(format!("code 插件不提供原生命令：{cmd}"))
}

hi_export_plugin!("hieditor.code", "1.0.0", run);
