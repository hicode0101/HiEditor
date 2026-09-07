//! Markdown 内置插件（FR-7 / UI-2.5 / UI-6）。
//! v1 骨架：贡献经 config.json 声明（语言/工具栏/编辑视图），所见即所得渲染
//! 由前端 Milkdown 资源承载（EP-4/EP-5），本动态库仅满足 ABI 契约。

use hi_editor_plugin_abi::hi_export_plugin;

fn run(cmd: &str, _text: &str, _opts: &str) -> Result<String, String> {
    Err(format!("markdown 插件不提供原生命令：{cmd}"))
}

hi_export_plugin!("com.hieditor.markdown", "1.0.0", run);
