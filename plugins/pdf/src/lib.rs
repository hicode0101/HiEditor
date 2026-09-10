//! PDF 阅读插件（FR-18.8）：声明 .pdf 扩展名，渲染由前端内置 pdf.js 查看器实现。

use hi_editor_plugin_abi::hi_export_plugin;

fn run(cmd: &str, _text: &str, _opts: &str) -> Result<String, String> {
    Err(format!("pdf 插件不提供原生命令：{cmd}"))
}

hi_export_plugin!("hieditor.pdf", "1.0.0", run);
