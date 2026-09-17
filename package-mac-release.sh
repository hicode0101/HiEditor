#!/usr/bin/env bash
# HiEditor macOS 打包脚本：编译 + 收集运行文件 + 生成 HiEditor-mac(arm)64-v版本.zip
# 用法: ./package-mac-release.sh [版本号=1.0.0] [排除插件=""] [输出目录=dist] [Rust目标三元组]
#   第 4 参为空 = 编译本机架构；指定如 x86_64-apple-darwin 则交叉编译
#   （GitHub 已下线 Intel 机型的 macos-13 runner，Intel 包由 arm64 机器交叉编译产出）
set -euo pipefail
cd "$(dirname "$0")"

VERSION="${1:-1.0.0}"
EXCLUDE_PLUGINS="${2:-}"
OUT_DIR="${3:-dist}"
RUST_TARGET="${4:-}"

if [ -n "$RUST_TARGET" ]; then
  case "$RUST_TARGET" in
    x86_64*)          PKG_ARCH="mac64" ;;
    aarch64*|arm64*)  PKG_ARCH="mac-arm64" ;;
    *) echo "[错误] 无法识别的 Rust 目标：$RUST_TARGET"; exit 1 ;;
  esac
  BIN_DIR="target/$RUST_TARGET/release"
else
  ARCH="$(uname -m)"
  if [ "$ARCH" = "x86_64" ]; then PKG_ARCH="mac64"; else PKG_ARCH="mac-arm64"; fi
  BIN_DIR="target/release"
fi
PKG="HiEditor-${PKG_ARCH}-v${VERSION}"
STAGE="$OUT_DIR/$PKG"

echo "============================================"
echo " HiEditor 打包脚本 (macOS)"
echo " 产物: $OUT_DIR/$PKG.zip"
[ -n "$RUST_TARGET" ] && echo " 交叉编译目标: $RUST_TARGET"
[ -n "$EXCLUDE_PLUGINS" ] && echo " 排除插件: $EXCLUDE_PLUGINS"
echo "============================================"

command -v cargo >/dev/null 2>&1 || { echo "[错误] 未找到 cargo，请先安装 Rust 工具链。"; exit 1; }

if [ -n "$RUST_TARGET" ]; then
  echo "[1/5] 安装目标平台 Rust 标准库并交叉编译 release（主程序 + 插件）..."
  rustup target add "$RUST_TARGET"
  cargo build --release --target "$RUST_TARGET"
else
  echo "[1/5] 编译 release 版本（主程序 + 插件）..."
  cargo build --release
fi

echo "[2/5] 结束运行中的 HiEditor（避免文件占用）..."
pkill -x HiEditor 2>/dev/null || true

echo "[3/5] 准备打包目录..."
rm -rf "$STAGE"
mkdir -p "$STAGE/plugins"
cp "$BIN_DIR/HiEditor" "$STAGE/"

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
        # cargo 产物带 lib 前缀（libhieditor_x.dylib），重命名为 manifest 声明的名称
        cp "$BIN_DIR/libhieditor_$p.dylib" "$STAGE/plugins/$p/bin/hieditor_$p.dylib"
    fi
done

echo "[4/5] 生成压缩包 $OUT_DIR/$PKG.zip ..."
mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR/$PKG.zip"
(cd "$STAGE" && zip -qr "../$PKG.zip" .)

echo "[5/5] 完成！"
echo "      压缩包: $(pwd)/$OUT_DIR/$PKG.zip"
echo "      解压后直接运行 HiEditor（首次运行若被 Gatekeeper 拦截，可执行: xattr -d com.apple.quarantine HiEditor）。"
