//! 换行符检测与归一化（FR-6.2）。
//!
//! 检测取数量最多的类型；保存时统一转换为状态栏显示的类型（经典记事本行为）。

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Eol {
    Crlf,
    Lf,
    Cr,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Counts {
    pub crlf: usize,
    pub lf: usize,
    pub cr: usize,
}

impl Eol {
    pub fn key(&self) -> &'static str {
        match self {
            Eol::Crlf => "crlf",
            Eol::Lf => "lf",
            Eol::Cr => "cr",
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            Eol::Crlf => "Windows (CRLF)",
            Eol::Lf => "Unix (LF)",
            Eol::Cr => "Mac (CR)",
        }
    }

    pub fn from_key(key: &str) -> Option<Eol> {
        match key {
            "crlf" => Some(Eol::Crlf),
            "lf" => Some(Eol::Lf),
            "cr" => Some(Eol::Cr),
            _ => None,
        }
    }

    fn seq(&self) -> &'static str {
        match self {
            Eol::Crlf => "\r\n",
            Eol::Lf => "\n",
            Eol::Cr => "\r",
        }
    }
}

/// 扫描全文统计三种换行符数量，返回数量最多的类型（并列时按 CRLF > LF > CR 取）。
pub fn detect(text: &str) -> (Eol, Counts) {
    let mut counts = Counts::default();
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\r' if i + 1 < bytes.len() && bytes[i + 1] == b'\n' => {
                counts.crlf += 1;
                i += 2;
            }
            b'\r' => {
                counts.cr += 1;
                i += 1;
            }
            b'\n' => {
                counts.lf += 1;
                i += 1;
            }
            _ => i += 1,
        }
    }
    let eol = if counts.crlf >= counts.lf && counts.crlf >= counts.cr && counts.crlf > 0 {
        Eol::Crlf
    } else if counts.lf >= counts.cr && counts.lf > 0 {
        Eol::Lf
    } else if counts.cr > 0 {
        Eol::Cr
    } else {
        // 无换行符（含空文档）：按平台无关的默认 CRLF（FR-6.3 与截图一致）。
        Eol::Crlf
    };
    (eol, counts)
}

/// 把全文统一转换为指定换行符。
pub fn normalize(text: &str, target: Eol) -> String {
    let (current, counts) = detect(text);
    let total = counts.crlf + counts.lf + counts.cr;
    let pure = (counts.crlf > 0) as u8 + (counts.lf > 0) as u8 + (counts.cr > 0) as u8;
    if total == 0 || (pure == 1 && current == target) {
        return text.to_string();
    }
    let t = target.seq();
    let mut out = String::with_capacity(text.len() + 16);
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                out.push_str(t);
            }
            '\n' => out.push_str(t),
            other => out.push(other),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_majority() {
        let (eol, counts) = detect("a\r\nb\nc\r\nd");
        assert_eq!(eol, Eol::Crlf);
        assert_eq!(counts.crlf, 2);
        assert_eq!(counts.lf, 1);
    }

    #[test]
    fn empty_defaults_to_crlf() {
        assert_eq!(detect("").0, Eol::Crlf);
        assert_eq!(detect("no newline").0, Eol::Crlf);
    }

    #[test]
    fn normalizes_all_three() {
        let mixed = "a\r\nb\nc\rd";
        assert_eq!(normalize(mixed, Eol::Lf), "a\nb\nc\nd");
        assert_eq!(normalize(mixed, Eol::Crlf), "a\r\nb\r\nc\r\nd");
        assert_eq!(normalize(mixed, Eol::Cr), "a\rb\rc\rd");
    }

    #[test]
    fn keys_and_labels() {
        assert_eq!(Eol::from_key("lf").unwrap().label(), "Unix (LF)");
        assert_eq!(Eol::Crlf.key(), "crlf");
    }
}
