//! 插件宿主实现：目录扫描 → config.json 校验 → 开关判断 → 动态库加载 → 命令分发。
//! 单插件失败只影响自身（FR-18.5），继续加载其余插件（附录 C.5）。

use crate::manifest::{Manifest, REQUIRED_API_VERSION};
use hi_editor_plugin_abi as abi;
use libloading::{Library, Symbol};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PluginStatus {
    /// 已加载并注册。
    Loaded,
    /// `enabled=false`：忽略加载（FR-18.3）。
    Disabled,
    /// 加载失败，附原因（FR-14.7）。
    Failed(String),
}

#[derive(Debug)]
pub struct LoadedPlugin {
    pub folder: PathBuf,
    pub manifest: Manifest,
    pub status: PluginStatus,
    pub native_id: Option<String>,
    pub native_version: Option<String>,
    lib: Option<Library>,
}

impl LoadedPlugin {
    /// 语言/格式化贡献只有"已加载"的插件才对外提供。
    pub fn is_active(&self) -> bool {
        self.status == PluginStatus::Loaded
    }
}

pub struct PluginHost {
    pub plugins: Vec<LoadedPlugin>,
}

impl Default for PluginHost {
    fn default() -> Self {
        Self { plugins: Vec::new() }
    }
}

fn read_meta(lib: &Library) -> Result<(String, String), String> {
    unsafe {
        let meta_fn: Symbol<abi::HiFnMeta> = lib
            .get(b"hi_plugin_meta")
            .map_err(|e| format!("缺少 hi_plugin_meta：{e}"))?;
        let meta = meta_fn();
        let id = abi::cstr_to_string(meta.id);
        let version = abi::cstr_to_string(meta.version);
        let api_fn: Symbol<abi::HiFnApiVersion> = lib
            .get(b"hi_plugin_api_version")
            .map_err(|e| format!("缺少 hi_plugin_api_version：{e}"))?;
        if api_fn() != REQUIRED_API_VERSION {
            return Err(format!(
                "apiVersion 不匹配：插件为 {}，宿主为 {REQUIRED_API_VERSION}",
                api_fn()
            ));
        }
        Ok((id, version))
    }
}

fn load_library(path: &Path) -> Result<(Library, String, String), String> {
    if !path.exists() {
        return Err(format!("入口文件不存在：{}", path.display()));
    }
    unsafe {
        let lib = Library::new(path).map_err(|e| format!("加载动态库失败：{e}"))?;
        let (id, version) = read_meta(&lib)?;
        let init_fn: Symbol<abi::HiFnInit> = lib
            .get(b"hi_plugin_init")
            .map_err(|e| format!("缺少 hi_plugin_init：{e}"))?;
        let code = init_fn();
        if code != 0 {
            return Err(format!("hi_plugin_init 返回 {code}"));
        }
        Ok((lib, id, version))
    }
}

impl PluginHost {
    /// 扫描若干插件根目录（安装目录 plugins → 用户目录，FR-18.9）。
    /// 同一插件 id 在多个目录出现时，先扫描到的（安装目录）优先。
    pub fn scan(dirs: &[PathBuf]) -> PluginHost {
        let mut host = PluginHost::default();
        let mut seen_ids: Vec<String> = Vec::new();
        for root in dirs {
            let entries = match std::fs::read_dir(root) {
                Ok(entries) => entries,
                Err(_) => continue,
            };
            let mut folders: Vec<PathBuf> = entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect();
            // FR-18.6：按子文件夹名字典序加载，冲突先到先得。
            folders.sort();
            for folder in folders {
                let config_path = folder.join("config.json");
                if !config_path.exists() {
                    continue; // 无 config.json 的文件夹不是插件，静默忽略。
                }
                let (manifest, status) = match Manifest::parse_file(&config_path) {
                    Ok(m) => (m, PluginStatus::Loaded),
                    Err(reason) => (placeholder_manifest(&folder), PluginStatus::Failed(reason)),
                };
                if seen_ids.contains(&manifest.id) {
                    continue;
                }
                seen_ids.push(manifest.id.clone());

                let (manifest, mut status) = if status == PluginStatus::Loaded && !manifest.enabled
                {
                    (manifest, PluginStatus::Disabled)
                } else {
                    (manifest, status)
                };

                let (lib, native_id, native_version, load_err) = if status == PluginStatus::Loaded
                {
                    match manifest.platform_entry() {
                        Some(rel) => match load_library(&folder.join(rel)) {
                            Ok((lib, id, ver)) => (Some(lib), Some(id), Some(ver), None),
                            Err(reason) => (None, None, None, Some(reason)),
                        },
                        None => (
                            None,
                            None,
                            None,
                            Some("config.json 缺少当前平台入口文件".into()),
                        ),
                    }
                } else {
                    (None, None, None, None)
                };
                if let Some(reason) = load_err {
                    if status == PluginStatus::Loaded {
                        status = PluginStatus::Failed(reason);
                    }
                }
                host.plugins.push(LoadedPlugin {
                    folder,
                    manifest,
                    status,
                    native_id,
                    native_version: None,
                    lib,
                });
            }
        }
        host
    }

    pub fn active_plugins(&self) -> impl Iterator<Item = &LoadedPlugin> {
        self.plugins.iter().filter(|p| p.is_active())
    }

    /// 聚合语言贡献（先注册者优先，FR-18.6）。
    pub fn languages(&self) -> Vec<&crate::manifest::LanguageDecl> {
        let mut out = Vec::new();
        for p in self.active_plugins() {
            for lang in &p.manifest.languages {
                if !out.iter().any(|l: &&crate::manifest::LanguageDecl| l.id == lang.id) {
                    out.push(lang);
                }
            }
        }
        out
    }

    /// 聚合格式化命令贡献。
    pub fn formatters(&self) -> Vec<(&LoadedPlugin, &crate::manifest::FormatterDecl)> {
        let mut out: Vec<(&LoadedPlugin, &crate::manifest::FormatterDecl)> = Vec::new();
        for p in self.active_plugins() {
            for f in &p.manifest.formatters {
                if !out.iter().any(|pair| pair.1.id == f.id) {
                    out.push((p, f));
                }
            }
        }
        out
    }

    /// 按扩展名解析语言 id（FR-17.1），无匹配 → "plaintext"。
    pub fn language_for_extension(&self, ext: &str) -> String {
        let ext = ext.trim_start_matches('.').to_ascii_lowercase();
        for lang in self.languages() {
            if lang
                .extensions
                .iter()
                .any(|e| e.trim_start_matches('.').to_ascii_lowercase() == ext)
            {
                return lang.id.clone();
            }
        }
        "plaintext".into()
    }

    /// 分发格式化命令到对应插件的动态库（FR-16.1 / 附录 C.4）。
    pub fn run_formatter(
        &mut self,
        formatter_id: &str,
        text: &str,
        opts_json: &str,
    ) -> Result<String, String> {
        let found = self
            .formatters()
            .into_iter()
            .find(|(_, f)| f.id == formatter_id)
            .map(|(p, f)| (p.manifest.id.clone(), f.command.clone()));
        let (plugin_id, command) = match found {
            Some(v) => v,
            None => return Err(format!("未找到格式化命令：{formatter_id}")),
        };
        let plugin = self
            .plugins
            .iter_mut()
            .find(|p| p.manifest.id == plugin_id && p.is_active())
            .ok_or_else(|| format!("插件 {plugin_id} 不可用"))?;
        let lib = plugin.lib.as_ref().ok_or("插件动态库未加载")?;
        unsafe {
            let cmd_fn: Symbol<abi::HiFnCommand> = lib
                .get(b"hi_plugin_command")
                .map_err(|e| format!("缺少 hi_plugin_command：{e}"))?;
            let free_fn: Symbol<abi::HiFnFreeString> = lib
                .get(b"hi_plugin_free_string")
                .map_err(|e| format!("缺少 hi_plugin_free_string：{e}"))?;
            let c_cmd = std::ffi::CString::new(command).map_err(|_| "命令名含非法字符")?;
            let c_text =
                std::ffi::CString::new(text).map_err(|_| "文本包含 NUL 字节".to_string())?;
            let c_opts = std::ffi::CString::new(opts_json).map_err(|_| "opts 含非法字符")?;
            let raw = cmd_fn(c_cmd.as_ptr(), c_text.as_ptr(), c_opts.as_ptr());
            if raw.is_null() {
                return Err("插件返回空结果".into());
            }
            let payload = abi::cstr_to_string(raw);
            free_fn(raw);
            parse_command_result(&payload)
        }
    }
}

fn parse_command_result(payload: &str) -> Result<String, String> {
    let v: serde_json::Value =
        serde_json::from_str(payload).map_err(|e| format!("插件返回值解析失败：{e}"))?;
    if v.get("ok").and_then(|b| b.as_bool()) == Some(true) {
        Ok(v.get("text")
            .and_then(|t| t.as_str())
            .unwrap_or_default()
            .to_string())
    } else {
        Err(v.get("error")
            .and_then(|e| e.as_str())
            .unwrap_or("未知插件错误")
            .to_string())
    }
}

/// config.json 解析失败时的占位 manifest：仅用于设置页展示文件夹名。
fn placeholder_manifest(folder: &Path) -> Manifest {
    let name = folder
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "?".into());
    // enabled=false 防止占位条目参与任何能力聚合。
    serde_json::from_str::<Manifest>(&format!(
        r#"{{ "id": "broken::{name}", "name": "{name}", "version": "0", "apiVersion": {REQUIRED_API_VERSION}, "enabled": false }}"#
    ))
    .expect("占位 manifest 必然可解析")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_plugin(root: &Path, name: &str, config: &str) -> PathBuf {
        let dir = root.join(name);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("config.json"), config).unwrap();
        dir
    }

    const ENABLED: &str = r#"{ "id": "a.b", "name": "A", "version": "1.0.0", "apiVersion": 1, "enabled": true,
        "entry": { "windows": "bin/missing.dll" },
        "languages": [ { "id": "x", "name": "X", "extensions": [".x"] } ] }"#;
    const DISABLED: &str = r#"{ "id": "c.d", "name": "C", "version": "1.0.0", "apiVersion": 1, "enabled": false }"#;

    #[test]
    fn scan_classifies_statuses() {
        let tmp = tempfile::tempdir().unwrap();
        write_plugin(tmp.path(), "alpha", ENABLED);
        write_plugin(tmp.path(), "beta", DISABLED);
        fs::create_dir_all(tmp.path().join("not-a-plugin")).unwrap();

        let host = PluginHost::scan(&[tmp.path().to_path_buf()]);
        assert_eq!(host.plugins.len(), 2);
        let a = host.plugins.iter().find(|p| p.manifest.name == "A").unwrap();
        assert!(matches!(a.status, PluginStatus::Failed(_))); // dll 缺失
        let c = host.plugins.iter().find(|p| p.manifest.name == "C").unwrap();
        assert_eq!(c.status, PluginStatus::Disabled);
        assert!(host.active_plugins().count() == 0);
    }

    #[test]
    fn broken_config_is_reported_not_crash() {
        let tmp = tempfile::tempdir().unwrap();
        write_plugin(tmp.path(), "gamma", "{ nope");
        let host = PluginHost::scan(&[tmp.path().to_path_buf()]);
        assert_eq!(host.plugins.len(), 1);
        assert!(matches!(host.plugins[0].status, PluginStatus::Failed(_)));
    }

    #[test]
    fn extension_lookup_and_priority() {
        // 单元级验证：无动态库可加载，直接构造"已加载"状态的宿主来验证 FR-18.6 优先级。
        let mk = |id: &str, name: &str, lang_id: &str| LoadedPlugin {
            folder: PathBuf::from("."),
            manifest: serde_json::from_str::<Manifest>(&format!(
                r#"{{ "id": "{id}", "name": "{name}", "version": "1", "apiVersion": 1, "enabled": true,
                     "languages": [ {{ "id": "{lang_id}", "name": "{name}", "extensions": [".json"] }} ] }}"#
            ))
            .unwrap(),
            status: PluginStatus::Loaded,
            native_id: None,
            native_version: None,
            lib: None,
        };
        let host = PluginHost {
            plugins: vec![
                mk("p.1", "P1", "json"),
                mk("p.2", "P2", "json2"),
            ],
        };
        // 字典序 p.1 先注册 → json 归 P1（FR-18.6）。
        assert_eq!(host.language_for_extension(".JSON"), "json");
        assert_eq!(host.language_for_extension(".md"), "plaintext");
    }
}
