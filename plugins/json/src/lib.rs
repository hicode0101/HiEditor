//! JSON 内置插件（FR-16.3）：严格 RFC 8259 解析 + pretty / minify。
//! preserve_order 保证键序不变；空对象/数组不展开；错误带行列定位。

use hi_editor_plugin_abi::hi_export_plugin;
use serde_json::Value;

fn position_of(text: &str, err: &serde_json::Error) -> String {
    format!("第 {} 行, 第 {} 列：{}", err.line(), err.column(), err)
}

fn comment_marker_present(text: &str) -> bool {
    let trimmed = text.trim_start();
    let mut in_string = false;
    let mut escaped = false;
    let bytes = trimmed.as_bytes();
    for (i, &b) in bytes.iter().enumerate() {
        if in_string {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_string = false;
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'/' if i + 1 < bytes.len() && (bytes[i + 1] == b'/' || bytes[i + 1] == b'*') => {
                return true
            }
            _ => {}
        }
    }
    false
}

fn parse(text: &str) -> Result<Value, String> {
    serde_json::from_str(text).map_err(|e| {
        if comment_marker_present(text) {
            "JSONC 含注释，暂不支持格式化".to_string()
        } else {
            position_of(text, &e)
        }
    })
}

fn indent_of(opts: &str) -> String {
    let n = serde_json::from_str::<Value>(opts)
        .ok()
        .and_then(|v| v.get("indent").and_then(|i| i.as_u64()))
        .unwrap_or(4);
    if n == 0 {
        "\t".to_string()
    } else {
        " ".repeat(n as usize)
    }
}

/// 手写序列化：键序保留、空容器不展开、冒号后单空格（FR-16.3）。
fn write_value(out: &mut String, value: &Value, level: usize, indent: &str) {
    match value {
        Value::Object(map) => {
            if map.is_empty() {
                out.push_str("{}");
                return;
            }
            out.push_str("{\n");
            let pad = indent.repeat(level + 1);
            let last = map.len() - 1;
            for (i, (key, val)) in map.iter().enumerate() {
                out.push_str(&pad);
                out.push_str(&serde_json::to_string(key).unwrap_or_default());
                out.push_str(": ");
                write_value(out, val, level + 1, indent);
                if i != last {
                    out.push(',');
                }
                out.push('\n');
            }
            out.push_str(&indent.repeat(level));
            out.push('}');
        }
        Value::Array(items) => {
            if items.is_empty() {
                out.push_str("[]");
                return;
            }
            out.push_str("[\n");
            let pad = indent.repeat(level + 1);
            let last = items.len() - 1;
            for (i, val) in items.iter().enumerate() {
                out.push_str(&pad);
                write_value(out, val, level + 1, indent);
                if i != last {
                    out.push(',');
                }
                out.push('\n');
            }
            out.push_str(&indent.repeat(level));
            out.push(']');
        }
        Value::String(s) => out.push_str(&serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())),
        other => out.push_str(&other.to_string()),
    }
}

fn run(cmd: &str, text: &str, opts: &str) -> Result<String, String> {
    match cmd {
        "pretty" => {
            let value = parse(text)?;
            let mut out = String::new();
            write_value(&mut out, &value, 0, &indent_of(opts));
            Ok(out)
        }
        "minify" => {
            let value = parse(text)?;
            serde_json::to_string(&value).map_err(|e| e.to_string())
        }
        other => Err(format!("未知命令：{other}")),
    }
}

hi_export_plugin!("com.hieditor.json", "1.0.0", run);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pretty_keeps_order_and_collapses_empty() {
        let src = r#"{"b":1,"a":{"n":[1,2],"e":{},"ea":[]},"中文":"值"}"#;
        let out = run("pretty", src, r#"{"indent":4}"#).unwrap();
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(lines[0], "{");
        assert!(lines[1].trim().starts_with("\"b\": 1"));
        assert!(out.contains("\"a\": {"));
        assert!(out.contains("\"e\": {}"));
        assert!(out.contains("\"ea\": []"));
        assert!(out.contains("\"中文\": \"值\""));
        assert!(out.ends_with("}"));
    }

    #[test]
    fn minify_strips_whitespace() {
        let out = run("minify", "{ \"a\" : [ 1 , 2 ] }\n", "{}").unwrap();
        assert_eq!(out, "{\"a\":[1,2]}");
    }

    #[test]
    fn error_reports_line_col() {
        let err = run("pretty", "{\n  \"a\": 1,\n  \"b\": \n}", "{}").unwrap_err();
        assert!(err.contains("第"), "got {err}");
    }

    #[test]
    fn jsonc_comment_message() {
        let err = run("pretty", "{\n  // 注释\n  \"a\": 1\n}", "{}").unwrap_err();
        assert!(err.contains("JSONC 含注释"), "got {err}");
    }
}
