fn main() {
    // frontendDist 下的文件变化必须触发资产重新收集（否则新增/修改的 js 不会进入二进制）
    println!("cargo:rerun-if-changed=../../ui");
    tauri_build::build();
}
