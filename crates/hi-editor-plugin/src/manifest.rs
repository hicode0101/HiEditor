//! config.json 反序列化（附录 C.2）。未知字段一律忽略，向前兼容。

use serde::Deserialize;
use std::path::{Path, PathBuf};

pub const REQUIRED_API_VERSION: u32 = hi_editor_plugin_abi::HI_PLUGIN_API_VERSION;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(alias = "apiVersion")]
    pub api_version: serde_json::Value,
    pub enabled: bool,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    pub entry: Option<Entry>,
    #[serde(default)]
    pub frontend: Option<String>,
    #[serde(default)]
    pub languages: Vec<LanguageDecl>,
    #[serde(default)]
    pub formatters: Vec<FormatterDecl>,
    #[serde(default)]
    pub menus: Option<MenusDecl>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub windows: Option<String>,
    pub linux: Option<String>,
    pub macos: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageDecl {
    pub id: String,
    pub name: String,
    pub extensions: Vec<String>,
    #[serde(default = "default_true")]
    pub highlight: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatterDecl {
    pub id: String,
    pub label: String,
    /// 适用语言 id；"any" 表示不限制。
    #[serde(default = "default_any")]
    pub language: String,
    /// 传给插件 hi_plugin_command 的命令名（如 "pretty" / "minify"）。
    pub command: String,
    #[serde(default)]
    pub shortcut: Option<String>,
}

fn default_any() -> String {
    "any".into()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenusDecl {
    #[serde(default)]
    pub context: Vec<String>,
}

impl Manifest {
    pub fn parse(json: &str) -> Result<Manifest, String> {
        let m: Manifest =
            serde_json::from_str(json).map_err(|e| format!("config.json 解析失败：{e}"))?;
        if m.id.trim().is_empty() || m.name.trim().is_empty() {
            return Err("id / name 不能为空".into());
        }
        match &m.api_version {
            serde_json::Value::Number(n) => {
                let v = n.as_u64().unwrap_or(0) as u32;
                if v != REQUIRED_API_VERSION {
                    return Err(format!(
                        "apiVersion 不匹配：插件要求 {v}，宿主为 {REQUIRED_API_VERSION}"
                    ));
                }
            }
            other => {
                return Err(format!("apiVersion 必须为数字，实际为 {other}"));
            }
        }
        Ok(m)
    }

    pub fn parse_file(path: &Path) -> Result<Manifest, String> {
        let raw = std::fs::read_to_string(path)
            .map_err(|e| format!("读取 config.json 失败：{e}"))?;
        Self::parse(&raw)
    }

    /// 当前平台应加载的动态库相对路径。
    pub fn platform_entry(&self) -> Option<String> {
        let entry = self.entry.as_ref()?;
        if cfg!(target_os = "windows") {
            entry.windows.clone()
        } else if cfg!(target_os = "macos") {
            entry.macos.clone()
        } else {
            entry.linux.clone()
        }
    }

    /// 平台动态库原始文件名（不含目录），供构建产物对照。
    pub fn entry_file_name(&self) -> Option<String> {
        let rel = self.platform_entry()?;
        PathBuf::from(rel)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
        "id": "hieditor.json",
        "name": "JSON 支持",
        "version": "1.0.0",
        "apiVersion": 1,
        "enabled": true,
        "entry": { "windows": "bin/hieditor_json.dll", "linux": "bin/hieditor_json.so", "macos": "bin/hieditor_json.dylib" },
        "languages": [ { "id": "json", "name": "JSON", "extensions": [".json", ".jsonc"], "highlight": true } ],
        "formatters": [
            { "id": "json.pretty", "label": "JSON 格式化", "language": "json", "command": "pretty", "shortcut": "Ctrl+Shift+J" }
        ],
        "menus": { "context": ["format"] }
    }"#;

    #[test]
    fn parses_sample_manifest() {
        let m = Manifest::parse(SAMPLE).unwrap();
        assert_eq!(m.id, "hieditor.json");
        assert!(m.enabled);
        assert_eq!(m.platform_entry().unwrap(), "bin/hieditor_json.dll");
        assert_eq!(m.entry_file_name().unwrap(), "hieditor_json.dll");
        assert_eq!(m.languages[0].extensions, [".json", ".jsonc"]);
        assert_eq!(m.formatters[0].command, "pretty");
        assert!(m.formatters[0].shortcut.as_deref() == Some("Ctrl+Shift+J"));
    }

    #[test]
    fn rejects_bad_api_version() {
        let bad = SAMPLE.replace("\"apiVersion\": 1", "\"apiVersion\": 9");
        assert!(Manifest::parse(&bad).unwrap_err().contains("apiVersion"));
    }

    #[test]
    fn missing_entry_is_parseable() {
        // 入口缺失不是解析错误，而是加载阶段的"加载失败"（附录 C.5）。
        let no_entry = SAMPLE
            .split("\"entry\"")
            .take(1)
            .collect::<String>()
            .trim_end()
            .trim_end_matches(',')
            .to_string()
            + "}";
        let m = Manifest::parse(&no_entry).unwrap();
        assert!(m.platform_entry().is_none());
    }
}
