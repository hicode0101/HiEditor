//! 插件宿主与插件之间的稳定 C ABI 契约（需求文档 附录 C.4）。
//!
//! 约束：本 crate 只允许 `#[repr(C)]` 类型、`extern "C"` 函数与无依赖的工具函数，
//! 宿主与插件各自独立编译，仅通过本层约定对接。

use core::ffi::c_char;

/// 宿主插件 API 大版本。`config.json` 的 `apiVersion` 必须与之相等才可加载。
pub const HI_PLUGIN_API_VERSION: u32 = 1;

/// 插件元信息（`hi_plugin_meta` 返回，字符串指针指向插件内的静态数据）。
#[repr(C)]
#[derive(Clone, Copy)]
pub struct HiPluginMeta {
    pub id: *const c_char,
    pub version: *const c_char,
    pub api_version: u32,
}

pub type HiFnMeta = unsafe extern "C" fn() -> HiPluginMeta;
pub type HiFnApiVersion = unsafe extern "C" fn() -> u32;
pub type HiFnInit = unsafe extern "C" fn() -> i32;
/// 执行一条命令；返回 `{"ok":true,"text":...}` / `{"ok":false,"error":...}` 的 JSON CString，
/// 由宿主调用 `hi_plugin_free_string` 归还内存。
pub type HiFnCommand =
    unsafe extern "C" fn(cmd: *const c_char, text: *const c_char, opts: *const c_char) -> *mut c_char;
pub type HiFnFreeString = unsafe extern "C" fn(s: *mut c_char);
pub type HiFnShutdown = unsafe extern "C" fn() -> i32;

pub unsafe fn cstr_to_string(p: *const c_char) -> String {
    if p.is_null() {
        return String::new();
    }
    std::ffi::CStr::from_ptr(p).to_string_lossy().into_owned()
}

/// 无依赖的最小 JSON 字符串转义（插件侧避免强依赖 serde 也能正确回包）。
pub fn escape_json(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// 在插件 crate 中一行导出全部必需符号。
///
/// `$command: fn(cmd: &str, text: &str, opts: &str) -> Result<String, String>`
#[macro_export]
macro_rules! hi_export_plugin {
    ($id:expr, $version:expr, $command:path) => {
        #[no_mangle]
        pub extern "C" fn hi_plugin_meta() -> $crate::HiPluginMeta {
            static ID_BYTES: &[u8] = concat!($id, "\0").as_bytes();
            static VER_BYTES: &[u8] = concat!($version, "\0").as_bytes();
            $crate::HiPluginMeta {
                id: ID_BYTES.as_ptr() as *const core::ffi::c_char,
                version: VER_BYTES.as_ptr() as *const core::ffi::c_char,
                api_version: $crate::HI_PLUGIN_API_VERSION,
            }
        }

        #[no_mangle]
        pub extern "C" fn hi_plugin_api_version() -> u32 {
            $crate::HI_PLUGIN_API_VERSION
        }

        #[no_mangle]
        pub extern "C" fn hi_plugin_init() -> i32 {
            0
        }

        #[no_mangle]
        pub extern "C" fn hi_plugin_command(
            cmd: *const core::ffi::c_char,
            text: *const core::ffi::c_char,
            opts: *const core::ffi::c_char,
        ) -> *mut core::ffi::c_char {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| unsafe {
                let c = $crate::cstr_to_string(cmd);
                let t = $crate::cstr_to_string(text);
                let o = $crate::cstr_to_string(opts);
                match $command(&c, &t, &o) {
                    Ok(text) => {
                        format!("{{\"ok\":true,\"text\":{}}}", $crate::escape_json(&text))
                    }
                    Err(err) => {
                        format!("{{\"ok\":false,\"error\":{}}}", $crate::escape_json(&err))
                    }
                }
            }));
            let payload = match result {
                Ok(s) => s,
                Err(_) => "{\"ok\":false,\"error\":\"插件内部 panic\"}".to_string(),
            };
            match std::ffi::CString::new(payload) {
                Ok(c) => c.into_raw(),
                Err(_) => std::ptr::null_mut(),
            }
        }

        #[no_mangle]
        pub extern "C" fn hi_plugin_free_string(s: *mut core::ffi::c_char) {
            if !s.is_null() {
                unsafe {
                    drop(std::ffi::CString::from_raw(s));
                }
            }
        }

        #[no_mangle]
        pub extern "C" fn hi_plugin_shutdown() -> i32 {
            0
        }
    };
}
