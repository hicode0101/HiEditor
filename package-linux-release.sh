#!/usr/bin/env bash
# HiEditor Linux 打包脚本：编译 + 收集运行文件 + 生成 HiEditor-linux(arm)64-v版本.zip
# 用法: ./package-linux-release.sh [版本号=1.0.0] [排除插件="code txt"] [输出目录=dist]
# 依赖: webkit2gtk-4.1 / gtk3 开发库（Debian/Ubuntu: sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev build-essential）
set -euo pipefail
cd "$(dirname "$0")"

VERSION="${1:-1.0.0}"
EXCLUDE_PLUGINS="${2:-}"
OUT_DIR="${3:-dist}"
ARCH="$(uname -m)"
if [ "$ARCH" = "x86_64" ]; then PKG_ARCH="linux64"; else PKG_ARCH="linux-arm64"; fi
PKG="HiEditor-${PKG_ARCH}-v${VERSION}"
STAGE="$OUT_DIR/$PKG"

echo "============================================"
echo " HiEditor 打包脚本 (Linux)"
echo " 产物: $OUT_DIR/$PKG.zip"
[ -n "$EXCLUDE_PLUGINS" ] && echo " 排除插件: $EXCLUDE_PLUGINS"
echo "============================================"

command -v cargo >/dev/null 2>&1 || { echo "[错误] 未找到 cargo，请先安装 Rust 工具链。"; exit 1; }
if ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
    echo "[提示] 未检测到 webkit2gtk-4.1 开发库，编译可能失败。"
    echo "       Debian/Ubuntu: sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev build-essential libssl-dev"
fi

echo "[1/5] 编译 release 版本（主程序 + 插件）..."
cargo build --release

echo "[2/5] 结束运行中的 HiEditor（避免文件占用）..."
pkill -x HiEditor 2>/dev/null || true

echo "[3/5] 准备打包目录..."
rm -rf "$STAGE"
mkdir -p "$STAGE/plugins"
install -m 755 target/release/HiEditor "$STAGE/HiEditor"

for p in json xml markdown notepad txt code; do
    skip=""
    for e in $EXCLUDE_PLUGINS; do
        [ "$e" = "$p" ] && skip=1
    done
    if [ -n "$skip" ]; then
        echo "[跳过] 插件 $p 已配置为不打包。"
    elif [ ! -f "plugins/$p/config.json" ]; then
        echo "[警告] 缺少 plugins/$p/config.json，已跳过该插件。"
    else
        mkdir -p "$STAGE/plugins/$p/bin"
        cp "plugins/$p/config.json" "$STAGE/plugins/$p/"
        # cargo 产物带 lib 前缀（libhieditor_x.so），重命名为 manifest 声明的名称
        cp "target/release/libhieditor_$p.so" "$STAGE/plugins/$p/bin/hieditor_$p.so"
    fi
done

echo "[4/5] 生成压缩包 $OUT_DIR/$PKG.zip ..."
mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR/$PKG.zip"
if command -v zip >/dev/null 2>&1; then
    (cd "$STAGE" && zip -qr "../../$PKG.zip" .)
else
    echo "       未找到 zip 命令，使用 python3 压缩。"
    (cd "$STAGE" && python3 -m zipfile -c "../../$PKG.zip" .)
fi

echo "[5/5] 完成！"
echo "      压缩包: $(pwd)/$OUT_DIR/$PKG.zip"
echo "      解压后运行 HiEditor（chmod +x HiEditor 已自动设置）。"
