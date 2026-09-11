//! HiEditor Win11 前排右键菜单 COM 服务（稀疏 MSIX + IExplorerCommand，EmEditor 同款机制）。
//! explorer.exe 以 Apartment 线程加载本 DLL；Invoke 时启动同目录 HiEditor.exe 并传入所选文件路径。
//!
//! Windows 专属组件：非 Windows 目标下整个 crate 编译为空（#![cfg] 逐出全部内容），
//! 保证 `cargo build --release` 在 Linux/macOS 打包工作流中也能通过；产物 .so 无功能，不参与分发。

#![cfg(windows)]

use windows::core::{implement, Interface, GUID, HRESULT, PWSTR};
use windows::Win32::Foundation::{BOOL, E_FAIL, E_NOTIMPL, HINSTANCE, S_OK};
use windows::Win32::System::Com::{
    CoTaskMemAlloc, CoTaskMemFree, IBindCtx, IClassFactory, IClassFactory_Impl,
    CLSCTX_INPROC_SERVER,
};
use windows::Win32::System::LibraryLoader::GetModuleFileNameW;
use windows::Win32::System::SystemServices::{DLL_PROCESS_ATTACH, DLL_PROCESS_DETACH};
use windows::Win32::UI::Shell::{
    IEnumExplorerCommand, IExplorerCommand, IExplorerCommand_Impl, IShellItemArray,
    SIGDN_FILESYSPATH, ECF_DEFAULT,
};
use windows::core::IUnknown;

const CLASS_ID: GUID = GUID::from_u128(0x7B7F1B9A_6E21_4C8D_9A03_1F5C2D8B4E60);
const MENU_TITLE: &str = "用 HiEditor 编辑";

static DLL_DIR: std::sync::OnceLock<String> = std::sync::OnceLock::new();
/// 稀疏包清单与所需资产（include 进二进制，注册时写出）
pub const MANIFEST_XML: &str = include_str!("../Win11MenuManifest.xml");
pub const MANIFEST_FILE: &str = "HiEditorShellMenu.AppxManifest.xml";
pub const PACKAGE_NAME: &str = "HiEditor.ShellMenu";
pub const LOGO_PNG: &[u8] = include_bytes!("../hi-editor.png");
pub const SHELLMENU_DLL: &str = "hieditor_shellmenu.dll";


fn dll_dir() -> &'static str {
    DLL_DIR.get().map(|s| s.as_str()).unwrap_or("")
}

/// 把字符串复制到 CoTaskMemAlloc 内存（explorer 按 CoTaskMemFree 释放，符合 shell 契约）
fn alloc_pwstr(s: &str) -> PWSTR {
    let wide: Vec<u16> = s.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let ptr = CoTaskMemAlloc(wide.len() * 2) as *mut u16;
        if ptr.is_null() {
            return PWSTR::null();
        }
        std::ptr::copy_nonoverlapping(wide.as_ptr(), ptr, wide.len());
        PWSTR(ptr)
    }
}

fn launch_editor(selected: Option<&str>) -> Result<(), windows::core::Error> {
    let dir = dll_dir();
    if dir.is_empty() {
        return Err(E_FAIL.into());
    }
    let exe = std::path::Path::new(dir).join("HiEditor.exe");
    let mut cmd = std::process::Command::new(exe);
    if let Some(s) = selected {
        cmd.arg(s);
    }
    cmd.spawn().map_err(|_| windows::core::Error::from(E_FAIL))?;
    Ok(())
}

fn selected_path(psi: Option<&IShellItemArray>) -> Option<String> {
    let array = psi?;
    let item = unsafe { array.GetItemAt(0).ok()? };
    let pw = unsafe { item.GetDisplayName(SIGDN_FILESYSPATH).ok()? };
    let s = unsafe { pw.to_string().ok() };
    unsafe { CoTaskMemFree(Some(pw.as_ptr() as *const core::ffi::c_void)) };
    s
}

#[implement(IExplorerCommand)]
struct HiEditorCommand;

#[allow(non_snake_case)]
impl IExplorerCommand_Impl for HiEditorCommand_Impl {
    fn GetTitle(&self, _psi: Option<&IShellItemArray>) -> windows::core::Result<PWSTR> {
        Ok(alloc_pwstr(MENU_TITLE))
    }

    fn GetIcon(&self, _psi: Option<&IShellItemArray>) -> windows::core::Result<PWSTR> {
        let dir = dll_dir();
        if dir.is_empty() {
            return Err(E_FAIL.into());
        }
        Ok(alloc_pwstr(&format!("{dir}\\HiEditor.exe")))
    }

    fn GetToolTip(&self, _psi: Option<&IShellItemArray>) -> windows::core::Result<PWSTR> {
        Err(E_NOTIMPL.into())
    }

    fn GetCanonicalName(&self) -> windows::core::Result<GUID> {
        Ok(GUID::zeroed())
    }

    fn GetState(
        &self,
        _psi: Option<&IShellItemArray>,
        _foktobeslow: BOOL,
    ) -> windows::core::Result<u32> {
        Ok(ECF_DEFAULT.0 as u32)
    }

    fn Invoke(
        &self,
        psi: Option<&IShellItemArray>,
        _pbc: Option<&IBindCtx>,
    ) -> windows::core::Result<()> {
        launch_editor(selected_path(psi).as_deref())
    }

    fn GetFlags(&self) -> windows::core::Result<u32> {
        Ok(0)
    }

    fn EnumSubCommands(&self) -> windows::core::Result<IEnumExplorerCommand> {
        Err(E_NOTIMPL.into())
    }
}

#[implement(IClassFactory)]
struct ClassFactory;

#[allow(non_snake_case)]
impl IClassFactory_Impl for ClassFactory_Impl {
    fn CreateInstance(
        &self,
        punkouter: Option<&IUnknown>,
        riid: *const GUID,
        ppvobject: *mut *mut core::ffi::c_void,
    ) -> windows::core::Result<()> {
        unsafe {
            if punkouter.is_some() {
                return Err(windows::Win32::Foundation::CLASS_E_CLASSNOTAVAILABLE.into());
            }
            // riid 编译期未知，直接用 IUnknown vtable 执行真实 QueryInterface
            let unknown: IUnknown = HiEditorCommand.into();
            (Interface::vtable(&unknown).QueryInterface)(unknown.as_raw(), riid, ppvobject).ok()
        }
    }

    fn LockServer(&self, _flock: BOOL) -> windows::core::Result<()> {
        Ok(())
    }
}

#[no_mangle]
extern "system" fn DllGetClassObject(
    rclsid: *const GUID,
    riid: *const GUID,
    ppv: *mut *mut core::ffi::c_void,
) -> HRESULT {
    unsafe {
        if rclsid.is_null() || riid.is_null() || ppv.is_null() {
            return E_FAIL;
        }
        if *rclsid != CLASS_ID {
            return windows::Win32::Foundation::CLASS_E_CLASSNOTAVAILABLE.into();
        }
        let factory: IClassFactory = ClassFactory.into();
        let hr = (Interface::vtable(&factory).base__.QueryInterface)(Interface::as_raw(&factory), riid, ppv);
        if hr != windows::core::HRESULT::default() {
            return hr;
        }
        hr
    }
}

#[no_mangle]
extern "system" fn DllCanUnloadNow() -> HRESULT {
    S_OK
}

#[no_mangle]
extern "system" fn DllMain(hinst: HINSTANCE, reason: u32, _reserved: *mut core::ffi::c_void) -> BOOL {
    if reason == DLL_PROCESS_ATTACH {
        unsafe {
            let mut buf = [0u16; 1024];
            let len = GetModuleFileNameW(windows::Win32::Foundation::HMODULE(hinst.0), &mut buf);
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            let dir = std::path::Path::new(&path)
                .parent()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            let _ = DLL_DIR.set(dir);
        }
    }
    BOOL(1)
}

