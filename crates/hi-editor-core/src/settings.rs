//! 设置持久化（FR-9 / UI-5.8）。JSON 存于用户数据目录，损坏时回退默认（BR-8）。

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Settings {
    // 外观
    pub theme: String,    // "light" | "dark"
    pub language: String, // "auto" | "zh-CN" | "en-US"
    // 文本编辑
    pub font_size: u32,
    pub font_family: String, // 空 = 跟随默认等宽字体栈
    pub tab_width: u32,
    pub wrap_default: bool,
    pub format_indent: u32,
    // 文件
    pub open_mode: String,        // "tab" | "window"
    pub default_eol: String,      // crlf | lf
    pub default_encoding: String, // utf8 | utf8-bom | ...
    pub large_file_mb: u32,
    pub new_tab_language: String, // "plaintext" | "markdown"
    // Markdown
    pub markdown_mode: String, // "wysiwyg" | "source"
    // 会话
    pub restore_session: bool,
    pub confirm_close: bool,
    // 窗口
    pub remember_window: bool, // 启动时恢复上次关闭时的窗口大小/位置（FR v1.7）
    // 插件
    pub user_plugins_dir: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "light".into(),
            language: "auto".into(),
            font_family: String::new(),
            font_size: 15,
            tab_width: 4,
            wrap_default: false,
            format_indent: 4,
            open_mode: "tab".into(),
            default_eol: "crlf".into(),
            default_encoding: "utf8".into(),
            large_file_mb: 10,
            new_tab_language: "plaintext".into(),
            markdown_mode: "wysiwyg".into(),
            restore_session: true,
            confirm_close: true,
            remember_window: false,
            user_plugins_dir: None,
        }
    }
}

pub fn load(path: &Path) -> Settings {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub fn save(path: &Path, settings: &Settings) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_vec_pretty(settings)?;
    // 原子写：先写临时文件再替换（FR-2.3）。
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_doc() {
        let s = Settings::default();
        assert_eq!(s.font_size, 15);
        assert_eq!(s.tab_width, 4);
        assert_eq!(s.format_indent, 4);
        assert_eq!(s.default_eol, "crlf");
        assert_eq!(s.default_encoding, "utf8");
        assert_eq!(s.markdown_mode, "wysiwyg");
        assert_eq!(s.new_tab_language, "plaintext");
    }

    #[test]
    fn roundtrip_and_corrupt_fallback() {
        let dir = std::env::temp_dir().join("hieditor-core-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");

        let mut s = Settings::default();
        s.font_size = 20;
        save(&path, &s).unwrap();
        assert_eq!(load(&path).font_size, 20);

        std::fs::write(&path, b"{broken").unwrap();
        assert_eq!(load(&path), Settings::default());
    }
}
