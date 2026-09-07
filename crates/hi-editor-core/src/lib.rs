//! HiEditor 纯 Rust 核心库：文件编码、换行符、设置持久化。
//! 不依赖 Tauri / 前端，可独立单测（FR-6、FR-9）。

pub mod encoding;
pub mod eol;
pub mod settings;
