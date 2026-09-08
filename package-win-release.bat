@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem ==================== 可配置项 ====================
rem 版本号：默认 1.0.0，可用第 1 个参数覆盖
set "VERSION=1.0.0"
if not "%~1"=="" set "VERSION=%~1"

rem 不打包进 zip 的插件目录名（空格分隔，如 "code txt"；留空 = 全部打包）
rem 也可用第 2 个参数覆盖：package-release.bat 1.0.0 "code txt"
set "EXCLUDE_PLUGINS=notepad"
if not "%~2"=="" set "EXCLUDE_PLUGINS=%~2"

rem zip 存放目录（相对项目根）
set "OUT_DIR=dist"
if not "%~3"=="" set "OUT_DIR=%~3"
rem =================================================

set "PKG=HiEditor-win64-v%VERSION%"
set "STAGE=%OUT_DIR%\%PKG%"

echo ============================================
echo  HiEditor 打包脚本 (win64)
echo  产物: %OUT_DIR%\%PKG%.zip
if defined EXCLUDE_PLUGINS echo  排除插件: !EXCLUDE_PLUGINS!
echo ============================================

where cargo >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 cargo，请先安装 Rust 工具链。
    pause
    exit /b 1
)

echo.
echo [1/5] 编译 release 版本（主程序 + 插件）...
cargo build --release
if errorlevel 1 (
    echo [错误] 编译失败，请检查上方输出。
    pause
    exit /b 1
)

echo.
echo [2/5] 结束运行中的 HiEditor（避免文件占用）...
taskkill /f /im HiEditor.exe >nul 2>nul

echo.
echo [3/5] 准备打包目录...
if exist "%STAGE%" rmdir /s /q "%STAGE%"
mkdir "%STAGE%\plugins" >nul 2>nul

copy /y "target\release\HiEditor.exe" "%STAGE%\" >nul
if errorlevel 1 (
    echo [错误] 复制主程序失败。
    pause
    exit /b 1
)

for %%p in (json xml markdown notepad txt code) do (
    set "SKIP="
    if defined EXCLUDE_PLUGINS (
        echo !EXCLUDE_PLUGINS!| findstr /i /c:"%%p" >nul && set "SKIP=1"
    )
    if defined SKIP (
        echo [跳过] 插件 %%p 已配置为不打包。
    ) else if not exist "plugins\%%p\config.json" (
        echo [警告] 缺少 plugins\%%p\config.json，已跳过该插件。
    ) else (
        if not exist "%STAGE%\plugins\%%p\bin" mkdir "%STAGE%\plugins\%%p\bin"
        copy /y "plugins\%%p\config.json" "%STAGE%\plugins\%%p\" >nul
        if exist "target\release\hieditor_%%p.dll" (
            copy /y "target\release\hieditor_%%p.dll" "%STAGE%\plugins\%%p\bin\" >nul
        ) else (
            echo [警告] 缺少 target\release\hieditor_%%p.dll，该插件将无法加载。
        )
    )
)

echo.
echo [4/5] 生成压缩包 %OUT_DIR%\%PKG%.zip ...
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"
if exist "%OUT_DIR%\%PKG%.zip" del /q "%OUT_DIR%\%PKG%.zip"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '%STAGE%\*' -DestinationPath '%OUT_DIR%\%PKG%.zip' -Force"
if errorlevel 1 (
    echo [错误] 压缩失败。
    pause
    exit /b 1
)

echo.
echo [5/5] 完成！
echo       压缩包: %~dp0%OUT_DIR%\%PKG%.zip
echo       解压后直接运行 HiEditor.exe（需系统 WebView2 运行时，Win11 自带）。

choice /c YN /m "是否打开压缩包所在目录"
if errorlevel 2 goto :end
explorer /select,"%~dp0%OUT_DIR%\%PKG%.zip"

:end
pause
