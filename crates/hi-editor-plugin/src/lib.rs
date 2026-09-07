//! 插件宿主：扫描 plugins 目录、解析 config.json、按 C ABI 加载动态库、
//! 聚合贡献（语言/格式化命令）并分发命令执行（FR-18 / 附录 C）。

pub mod host;
pub mod manifest;

pub use host::{LoadedPlugin, PluginHost, PluginStatus};
pub use manifest::{FormatterDecl, LanguageDecl, Manifest};
