//! XML 内置插件（FR-16.4）：声明/DOCTYPE/注释/CDATA 原样保留，
//! 含子元素的标签展开缩进，仅含文本的元素保持单行，属性不换行。

use hi_editor_plugin_abi::hi_export_plugin;
use quick_xml::events::Event;
use quick_xml::Reader;

fn position_of(src: &str, offset: usize, err: &quick_xml::Error) -> String {
    let before = &src[..offset.min(src.len())];
    let line = before.matches('\n').count() + 1;
    let col = before.rsplit('\n').next().map(|l| l.len()).unwrap_or(0) + 1;
    format!("第 {line} 行, 第 {col} 列：{err}")
}

struct OpenElem {
    /// 完整开始标签内部内容（`tag attr="v"`）。
    inner: String,
    name: String,
    /// 该元素开始标签在输出中的起始位置（'<')。
    start_out: usize,
    text: String,
    has_child: bool,
}

fn is_ws(s: &str) -> bool {
    s.chars().all(|c| c.is_whitespace())
}

fn qname(e: impl AsRef<[u8]>) -> String {
    String::from_utf8_lossy(e.as_ref()).into_owned()
}

fn pretty(src: &str, indent_str: &str, minify: bool) -> Result<String, String> {
    let mut reader = Reader::from_str(src);
    let mut out = String::new();
    let mut stack: Vec<OpenElem> = Vec::new();
    let mut depth: usize = 0;

    let mut line_prefix = |out: &mut String, depth: usize| {
        if !minify && !out.is_empty() {
            out.push('\n');
            out.push_str(&indent_str.repeat(depth));
        }
    };

    loop {
        let event = reader.read_event().map_err(|e| {
            position_of(src, reader.error_position() as usize, &e)
        })?;
        match event {
            Event::Eof => break,
            Event::Decl(e) => {
                out.push_str(&format!("<?{}?>", String::from_utf8_lossy(e.as_ref())));
                if minify {
                    out.push('\n');
                }
            }
            Event::DocType(e) => {
                line_prefix(&mut out, depth);
                out.push_str(&format!("<!DOCTYPE {}>", String::from_utf8_lossy(e.as_ref())));
            }
            Event::Comment(e) => {
                line_prefix(&mut out, depth);
                out.push_str(&format!(
                    "<!--{}-->",
                    String::from_utf8_lossy(e.as_ref())
                ));
            }
            Event::CData(e) => {
                let raw = String::from_utf8_lossy(e.as_ref()).into_owned();
                if let Some(top) = stack.last_mut() {
                    if !top.has_child {
                        top.text.push_str(&format!("<![CDATA[{raw}]]>"));
                        continue;
                    }
                }
                line_prefix(&mut out, depth);
                out.push_str(&format!("<![CDATA[{raw}]]>"));
            }
            Event::Start(e) => {
                if let Some(top) = stack.last_mut() {
                    top.has_child = true;
                }
                let inner = String::from_utf8_lossy(e.as_ref()).into_owned();
                let name = qname(e.name());
                line_prefix(&mut out, depth);
                let start_out = out.len();
                out.push_str(&format!("<{inner}>"));
                stack.push(OpenElem {
                    inner,
                    name,
                    start_out,
                    text: String::new(),
                    has_child: false,
                });
                depth += 1;
            }
            Event::Empty(e) => {
                if let Some(top) = stack.last_mut() {
                    top.has_child = true;
                }
                let inner = String::from_utf8_lossy(e.as_ref()).into_owned();
                line_prefix(&mut out, depth);
                out.push_str(&format!("<{inner}/>"));
            }
            Event::Text(e) => {
                let raw = String::from_utf8_lossy(e.as_ref()).into_owned();
                if is_ws(&raw) {
                    continue; // 标签间空白交给格式化决定。
                }
                if let Some(top) = stack.last_mut() {
                    if !top.has_child {
                        top.text.push_str(&raw);
                        continue;
                    }
                }
                // 混合内容：原样落在当前位置。
                out.push_str(&raw);
            }
            Event::End(e) => {
                let name = qname(e.name());
                let top = stack.pop().ok_or("XML 结构错误：多余的结束标签")?;
                if top.name != name {
                    return Err(format!(
                        "XML 结构错误：</{}> 与 <{}> 不匹配",
                        name, top.name
                    ));
                }
                depth = depth.saturating_sub(1);
                let text = if minify { top.text.clone() } else { top.text.trim().to_string() };
                if !top.has_child {
                    // 仅含文本（或为空）的元素保持单行（FR-16.4）；压缩模式文本原样保留。
                    let inline = if text.is_empty() {
                        format!("<{}></{}>", top.inner, top.name)
                    } else {
                        format!("<{}>{}</{}>", top.inner, text, top.name)
                    };
                    out.truncate(top.start_out);
                    out.push_str(&inline);
                } else {
                    line_prefix(&mut out, depth);
                    out.push_str(&format!("</{}>", top.name));
                }
            }
            Event::PI(e) => {
                line_prefix(&mut out, depth);
                out.push_str(&format!("<?{}?>", String::from_utf8_lossy(e.as_ref())));
            }
        }
    }
    if !stack.is_empty() {
        return Err("XML 结构错误：存在未闭合的标签".into());
    }
    Ok(out)
}

fn minify(src: &str) -> Result<String, String> {
    pretty(src, "", true)
}

fn run(cmd: &str, text: &str, opts: &str) -> Result<String, String> {
    let indent = serde_like_indent(opts);
    match cmd {
        "pretty" => pretty(text, &indent, false),
        "minify" => minify(text),
        other => Err(format!("未知命令：{other}")),
    }
}

fn serde_like_indent(opts: &str) -> String {
    // 避免引入 serde_json：手写极简 {"indent":N} 提取。
    if let Some(pos) = opts.find("\"indent\"") {
        let rest = &opts[pos + "\"indent\"".len()..];
        let digits: String = rest.chars().skip_while(|c| !c.is_ascii_digit()).take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(n) = digits.parse::<usize>() {
            if n > 0 {
                return " ".repeat(n);
            }
        }
    }
    " ".repeat(4)
}

hi_export_plugin!("com.hieditor.xml", "1.0.0", run);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inline_text_elements_stay_single_line() {
        let src = r#"<?xml version="1.0"?><root><name>HiEditor</name><list><i>1</i><i>2</i></list></root>"#;
        let out = run("pretty", src, "{\"indent\":2}").unwrap();
        let expected = "<?xml version=\"1.0\"?>\n<root>\n  <name>HiEditor</name>\n  <list>\n    <i>1</i>\n    <i>2</i>\n  </list>\n</root>";
        assert_eq!(out, expected);
    }

    #[test]
    fn minify_removes_only_tag_whitespace() {
        let src = "<root>\n  <a>  keep me  </a>\n  <b/>\n</root>";
        let out = run("minify", src, "").unwrap();
        assert_eq!(out, "<root><a>  keep me  </a><b/></root>");
    }

    #[test]
    fn comments_and_doctype_preserved() {
        let src = "<!-- hello --><!DOCTYPE note><r/>";
        let out = run("pretty", src, "{}").unwrap();
        assert!(out.contains("<!-- hello -->"));
        assert!(out.contains("<!DOCTYPE note>"));
        assert!(out.contains("<r/>"));
    }

    #[test]
    fn mismatch_reports_error() {
        let err = run("pretty", "<a></b>", "{}").unwrap_err();
        // quick-xml 自带末尾标签校验，错误须带行列定位（FR-16.5）。
        assert!(err.contains("第 1 行"), "got {err}");
    }
}
