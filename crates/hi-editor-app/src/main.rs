//! HiEditor Tauri 壳：窗口管理 + 前端命令（文件读写 / 插件注册表 / 格式化 / 设置）。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use hi_editor_core::{encoding as enc, eol, settings};
use hi_editor_plugin::host::{PluginHost, PluginStatus};
use hi_editor_plugin::manifest::Manifest;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HWND;

struct HostCell(Mutex<PluginHost>);

#[derive(Serialize)]
struct ReadOut {
    text: String,
    encoding: String,
    eol: String,
    /// ANSI 等容错解码时为 true（FR-14.6 横幅依据）。
    lossy: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RegistryDto {
    languages: Vec<LanguageDto>,
    formatters: Vec<FormatterDto>,
    encodings: Vec<(String, String)>,
    eols: Vec<(String, String)>,
    markdown_loaded: bool,
    /// 视图控件贡献（去重后的 kind 列表，如 fontFamily/fontSize）
    view_controls: Vec<String>,
}

#[derive(Serialize)]
struct LanguageDto {
    id: String,
    name: String,
    extensions: Vec<String>,
    highlight: bool,
}

#[derive(Serialize)]
struct FormatterDto {
    id: String,
    label: String,
    language: String,
    command: String,
    shortcut: Option<String>,
}

#[derive(Serialize)]
struct PluginDto {
    id: String,
    name: String,
    version: String,
    folder: String,
    enabled: bool,
    status: String,
    reason: Option<String>,
}

/// 插件目录解析：环境变量 → exe 同级 → exe 上级（dev 工作区布局）→ 当前目录。
fn resolve_plugins_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(env_dir) = std::env::var("HIEDITOR_PLUGINS_DIR") {
        dirs.push(PathBuf::from(env_dir));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            dirs.push(dir.join("plugins"));
            dirs.push(dir.join("../../plugins"));
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        dirs.push(resource_dir.join("plugins"));
    }
    dirs.push(PathBuf::from("plugins"));
    dirs
}

fn init_host(app: &AppHandle) -> PluginHost {
    let dirs = resolve_plugins_dirs(app);
    PluginHost::scan(&dirs)
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("settings.json"))
        .map_err(|e| format!("无法定位用户数据目录：{e}"))
}

fn session_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("session.json"))
        .map_err(|e| format!("无法定位用户数据目录：{e}"))
}

/// 读取上次会话（FR-10.2）；文件不存在返回 null，损坏时按无会话处理（BR-8）。
#[tauri::command]
fn load_session(app: AppHandle) -> Result<Option<serde_json::Value>, String> {
    let path = session_path(&app)?;
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s)
            .map(Some)
            .map_err(|e| format!("会话文件损坏：{e}")),
        Err(_) => Ok(None),
    }
}

/// 原子写入会话（FR-10.1/10.3：含未保存内容的标签状态）。
#[tauri::command]
fn save_session(app: AppHandle, session: serde_json::Value) -> Result<(), String> {
    let path = session_path(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(&session).map_err(|e| e.to_string())?)
        .map_err(|e| format!("写入会话失败：{e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("替换会话失败：{e}"))
}

#[tauri::command]
fn read_file(path: String, forced: Option<String>) -> Result<ReadOut, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("读取失败：{e}"))?;
    let (encoding, lossy) = match forced.as_deref().and_then(enc::Encoding::from_key) {
        Some(enc) => (enc, false),
        None => {
            let detected = enc::detect(&bytes);
            let lossy = matches!(detected, enc::Encoding::Ansi(_));
            (detected, lossy)
        }
    };
    let text = enc::decode(&bytes, &encoding);
    let (eol, _) = eol::detect(&text);
    Ok(ReadOut {
        text,
        encoding: encoding.key(),
        eol: eol.key().to_string(),
        lossy,
    })
}

#[tauri::command]
fn save_file(path: String, text: String, encoding: String, eol: String) -> Result<(), String> {
    let enc = enc::Encoding::from_key(&encoding).unwrap_or(enc::Encoding::Utf8);
    let target_eol = eol::Eol::from_key(&eol).unwrap_or(eol::Eol::Crlf);
    let normalized = eol::normalize(&text, target_eol);
    let bytes = enc::encode(&normalized, &enc);
    // 原子写：先写临时文件再替换（FR-2.3）。
    let tmp = PathBuf::from(format!("{path}.hieditor-tmp"));
    std::fs::write(&tmp, &bytes).map_err(|e| format!("写入失败：{e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("保存失败：{e}")
    })
}

#[tauri::command]
fn get_registry(host: State<HostCell>) -> RegistryDto {
    let host = host.0.lock().unwrap();
    let markdown_loaded = host
        .active_plugins()
        .any(|p| p.manifest.languages.iter().any(|l| l.id == "markdown"));
    let mut view_controls: Vec<String> = Vec::new();
    for p in host.active_plugins() {
        for vc in &p.manifest.view_controls {
            if !view_controls.iter().any(|v| v == vc) {
                view_controls.push(vc.clone());
            }
        }
    }
    RegistryDto {
        languages: host
            .languages()
            .iter()
            .map(|l| LanguageDto {
                id: l.id.clone(),
                name: l.name.clone(),
                extensions: l.extensions.clone(),
                highlight: l.highlight,
            })
            .collect(),
        formatters: host
            .formatters()
            .into_iter()
            .map(|(_, f)| FormatterDto {
                id: f.id.clone(),
                label: f.label.clone(),
                language: f.language.clone(),
                command: f.command.clone(),
                shortcut: f.shortcut.clone(),
            })
            .collect(),
        encodings: enc::ALL_CHOICES
            .iter()
            .map(|(k, label)| (k.to_string(), label.to_string()))
            .collect(),
        eols: [("crlf", "Windows (CRLF)"), ("lf", "Unix (LF)"), ("cr", "Mac (CR)")]
            .iter()
            .map(|(k, label)| (k.to_string(), label.to_string()))
            .collect(),
        markdown_loaded,
        view_controls,
    }
}

#[tauri::command]
fn get_plugins(host: State<HostCell>) -> Vec<PluginDto> {
    host.0
        .lock()
        .unwrap()
        .plugins
        .iter()
        .map(|p| {
            let (status, reason) = match &p.status {
                PluginStatus::Loaded => ("loaded", None),
                PluginStatus::Disabled => ("disabled", None),
                PluginStatus::Failed(r) => ("failed", Some(r.clone())),
            };
            PluginDto {
                id: p.manifest.id.clone(),
                name: p.manifest.name.clone(),
                version: p.manifest.version.clone(),
                folder: p.folder.display().to_string(),
                enabled: p.manifest.enabled,
                status: status.into(),
                reason,
            }
        })
        .collect()
}

#[tauri::command]
fn format_text(
    host: State<HostCell>,
    formatter_id: String,
    text: String,
    indent: u32,
) -> Result<String, String> {
    let opts = serde_json::json!({ "indent": indent }).to_string();
    host.0
        .lock()
        .unwrap()
        .run_formatter(&formatter_id, &text, &opts)
}

#[tauri::command]
fn get_settings(app: AppHandle) -> settings::Settings {
    match settings_path(&app) {
        Ok(path) => settings::load(&path),
        Err(_) => settings::Settings::default(),
    }
}

#[tauri::command]
fn save_settings(app: AppHandle, value: settings::Settings) -> Result<(), String> {
    let path = settings_path(&app)?;
    settings::save(&path, &value).map_err(|e| format!("保存设置失败：{e}"))
}

/// 将插件开关写回其 config.json 的 `enabled` 字段（FR-18.3）。
#[tauri::command]
fn set_plugin_enabled(host: State<HostCell>, plugin_id: String, enabled: bool) -> Result<(), String> {
    let folder: PathBuf = {
        let host = host.0.lock().unwrap();
        let plugin = host
            .plugins
            .iter()
            .find(|p| p.manifest.id == plugin_id)
            .ok_or_else(|| format!("未找到插件：{plugin_id}"))?;
        plugin.folder.clone()
    };
    let path = folder.join("config.json");
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("读取 config.json 失败：{e}"))?;
    let mut value: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("config.json 解析失败：{e}"))?;
    value["enabled"] = serde_json::Value::Bool(enabled);
    std::fs::write(&path, serde_json::to_vec_pretty(&value).unwrap())
        .map_err(|e| format!("写入 config.json 失败：{e}"))
}

/// 用系统默认浏览器打开链接（关于页"开源地址"，跨平台）。
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    // 白名单校验，防止经 start/xdg-open 注入参数。
    if !url.starts_with("https://") || url.chars().any(|c| c.is_whitespace() || c == '"') {
        return Err("非法的 URL".into());
    }
    #[cfg(target_os = "windows")]
    {
        // CREATE_NO_WINDOW：避免 windows_subsystem=windows 的正式版闪现命令行黑框
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("打开失败：{e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("打开失败：{e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("打开失败：{e}"))?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
mod winprint;

/// 调起系统 Win32 打印公共对话框并 GDI 直印（FR-2.11，Windows）；其他平台由前端回退。
#[tauri::command]
fn print_text(app: tauri::AppHandle, title: String, text: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = app
            .get_webview_window("main")
            .ok_or("主窗口不存在")?
            .hwnd()
            .map_err(|e| format!("获取窗口句柄失败：{e}"))?
            .0 as *mut core::ffi::c_void;
        return winprint::show_print_dialog(HWND(hwnd), &title, text);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (&app, &title, &text);
        Err("此平台暂不支持系统打印对话框".into())
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let host = init_host(app.handle());
            app.manage(HostCell(Mutex::new(host)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            save_file,
            get_registry,
            get_plugins,
            format_text,
            get_settings,
            save_settings,
            set_plugin_enabled,
            load_session,
            save_session,
            open_url,
            print_text
        ])
        .run(tauri::generate_context!())
        .expect("HiEditor 启动失败");
}

// 保留 Manifest 引用（类型文档化），避免被裁剪。
#[allow(dead_code)]
fn _manifest_type_check(_m: &Manifest) {}
