//! 记事本内置插件（FR-18.8）：提供纯文本的基础编辑兜底（原 plaintext 插件更名）。

use hi_editor_plugin_abi::hi_export_plugin;

fn run(cmd: &str, _text: &str, _opts: &str) -> Result<String, String> {
    Err(format!("plaintext 插件不提供原生命令：{cmd}"))
}

hi_export_plugin!("hieditor.plaintext", "1.0.0", run);
