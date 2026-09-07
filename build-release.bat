@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo  HiEditor Release 编译脚本
echo ============================================

where cargo >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 cargo，请先安装 Rust 工具链。
    pause
    exit /b 1
)

echo.
echo [1/3] 编译 release 版本（主程序 + 插件）...
cargo build --release
if errorlevel 1 (
    echo [错误] 编译失败，请检查上方输出。
    pause
    exit /b 1
)

echo.
echo [2/3] 结束运行中的 HiEditor 并同步插件...
taskkill /f /im hi-editor-app.exe >nul 2>nul
for %%p in (json xml markdown plaintext code) do (
    if not exist "plugins\%%p\bin" mkdir "plugins\%%p\bin"
    copy /y "target\release\hieditor_%%p.dll" "plugins\%%p\bin\" >nul
)
echo       插件已同步到 plugins\json、xml、markdown、plaintext、code 的 bin 目录

echo.
echo [3/3] 完成！
echo       主程序  target\release\hi-editor-app.exe
echo       插件    plugins\*\bin\hieditor_*.dll

choice /c YN /m "是否立即启动 HiEditor"
if errorlevel 2 goto :end
set "HIEDITOR_PLUGINS_DIR=%~dp0plugins"
start "" "%~dp0target\release\hi-editor-app.exe"

:end
pause
