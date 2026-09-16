// 全局常量定义：应用标识等不随运行状态变化的固定值统一放这里。
// 需要调整时只改本文件，其它模块通过 import 引用，避免多处硬编码漏改。
//
// 版本号不在此定义：单一来源是 crates/hi-editor-app/tauri.conf.json 的 "version"，
// 关于页经 Tauri API（getVersion）直接读取，改版本只需改 tauri.conf.json 一处。

export const APP_NAME = "HiEditor";

