//! TXT 编辑增强插件（FR-18.8）：为纯文本提供 字体 / 字号 视图控件（EP-5 视图控件）。
//! 控件渲染与生效由前端实现（CSS 变量 --editor-font-family / --editor-font-size）。

use hi_editor_plugin_abi::hi_export_plugin;

fn run(cmd: &str, _text: &str, _opts: &str) -> Result<String, String> {
    Err(format!("txt 插件不提供原生命令：{cmd}"))
}

hi_export_plugin!("hieditor.txt", "1.0.0", run);
