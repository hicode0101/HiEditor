@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem ==================== �?配置�? ====================
rem 版本号：默�?? 1.0.0，可用�?? 1 �?参数覆盖
set "VERSION=1.0.0"
if not "%~1"=="" set "VERSION=%~1"

rem 不打包进 zip 的插件目录名（空格分隔，�? "code txt"；留�? = 全部打包�?
rem 也可用�?? 2 �?参数覆盖：package-release.bat 1.0.0 "code txt"
set "EXCLUDE_PLUGINS=notepad"
if not "%~2"=="" set "EXCLUDE_PLUGINS=%~2"

rem zip 存放�?录（相�?�项�?根）
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
    echo [错�?�] �?找到 cargo，�?�先安�?? Rust 工具链�??
    pause
    exit /b 1
)

echo.
echo [1/5] 编译 release 版本（主程序 + 插件�?...
cargo build --release
if errorlevel 1 (
    echo [错�?�] 编译失败，�?��??查上方输出�??
    pause
    exit /b 1
)

echo.
echo [2/5] 结束运�?�中�? HiEditor（避免文件占�?�?...
taskkill /f /im HiEditor.exe >nul 2>nul

echo.
echo [3/5] 准�?�打包目�?...
if exist "%STAGE%" rmdir /s /q "%STAGE%"
mkdir "%STAGE%\plugins" >nul 2>nul

copy /y "target\release\HiEditor.exe" "%STAGE%\" >nul
if errorlevel 1 (
    echo [错�?�] 复制主程序失败�??
    pause
    exit /b 1
)

for %%p in (json xml markdown notepad txt code pdf) do (
    set "SKIP="
    if defined EXCLUDE_PLUGINS (
        echo !EXCLUDE_PLUGINS!| findstr /i /c:"%%p" >nul && set "SKIP=1"
    )
    if defined SKIP (
        echo [跳过] 插件 %%p 已配�?为不打包�?
    ) else if not exist "plugins\%%p\config.json" (
        echo [警告] 缺少 plugins\%%p\config.json，已跳过该插件�??
    ) else (
        if not exist "%STAGE%\plugins\%%p\bin" mkdir "%STAGE%\plugins\%%p\bin"
        copy /y "plugins\%%p\config.json" "%STAGE%\plugins\%%p\" >nul
        if exist "target\release\hieditor_%%p.dll" (
            copy /y "target\release\hieditor_%%p.dll" "%STAGE%\plugins\%%p\bin\" >nul
        ) else (
            echo [警告] 缺少 target\release\hieditor_%%p.dll，�?�插件将无法加载�?
        )
    )
)

echo.
echo [4/5] 生成压缩�? %OUT_DIR%\%PKG%.zip ...
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"
if exist "%OUT_DIR%\%PKG%.zip" del /q "%OUT_DIR%\%PKG%.zip"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '%STAGE%\*' -DestinationPath '%OUT_DIR%\%PKG%.zip' -Force"
if errorlevel 1 (
    echo [错�?�] 压缩失败�?
    pause
    exit /b 1
)

echo.
echo [5/5] 完成�?
echo       压缩�?: %~dp0%OUT_DIR%\%PKG%.zip
echo       解压后直接运�? HiEditor.exe（需系统 WebView2 运�?�时，Win11 �?带）�?

choice /c YN /m "�?否打�?压缩包所在目�?"
if errorlevel 2 goto :end
explorer /select,"%~dp0%OUT_DIR%\%PKG%.zip"

:end
pause
