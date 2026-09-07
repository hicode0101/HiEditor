//! 编码检测与转换（FR-6）。
//!
//! 检测顺序：BOM → 严格 UTF-8 校验 → chardetng 启发式（结合本地代码页）。
//! UI 展示用 `label()`（如 `UTF-8 (BOM)`），跨进程传输用 `key()`（如 `utf8-bom`）。

use encoding_rs::Encoding as RsEncoding;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Encoding {
    Utf8,
    Utf8Bom,
    Utf16Le,
    Utf16Be,
    /// chardetng / encoding_rs 的编码标签（如 "gb18030"、"windows-1252"）。
    Ansi(String),
}

impl Encoding {
    pub fn key(&self) -> String {
        match self {
            Encoding::Utf8 => "utf8".into(),
            Encoding::Utf8Bom => "utf8-bom".into(),
            Encoding::Utf16Le => "utf16le".into(),
            Encoding::Utf16Be => "utf16be".into(),
            // 常用中文编码给独立键，其余 ANSI 代码页走 ansi: 前缀
            Encoding::Ansi(label) => match label.as_str() {
                "gbk" | "gb18030" => label.clone(),
                other => format!("ansi:{other}"),
            },
        }
    }

    pub fn label(&self) -> String {
        match self {
            Encoding::Utf8 => "UTF-8".into(),
            Encoding::Utf8Bom => "UTF-8 (BOM)".into(),
            Encoding::Utf16Le => "UTF-16 LE".into(),
            Encoding::Utf16Be => "UTF-16 BE".into(),
            Encoding::Ansi(label) => match label.as_str() {
                "gbk" => "GBK".into(),
                "gb18030" => "GB18030".into(),
                other => format!("ANSI ({})", other.to_uppercase()),
            },
        }
    }

    /// 从 key 反解析（前端回传 / 设置持久化）。
    pub fn from_key(key: &str) -> Option<Encoding> {
        match key {
            "utf8" => Some(Encoding::Utf8),
            "utf8-bom" => Some(Encoding::Utf8Bom),
            "utf16le" => Some(Encoding::Utf16Le),
            "utf16be" => Some(Encoding::Utf16Be),
            "gbk" => Some(Encoding::Ansi("gbk".into())),
            "gb18030" => Some(Encoding::Ansi("gb18030".into())),
            other => other
                .strip_prefix("ansi:")
                .map(|label| Encoding::Ansi(label.to_string())),
        }
    }

    fn rs(&self) -> Option<&'static RsEncoding> {
        match self {
            Encoding::Utf16Le => Some(encoding_rs::UTF_16LE),
            Encoding::Utf16Be => Some(encoding_rs::UTF_16BE),
            Encoding::Ansi(label) => RsEncoding::for_label(label.as_bytes()),
            _ => None,
        }
    }
}

pub const ALL_CHOICES: &[(&str, &str)] = &[
    ("utf8", "UTF-8"),
    ("utf8-bom", "UTF-8 (BOM)"),
    ("utf16le", "UTF-16 LE"),
    ("utf16be", "UTF-16 BE"),
    ("gbk", "GBK"),
    ("gb18030", "GB18030"),
];

/// BOM → 严格 UTF-8 → chardetng。
pub fn detect(bytes: &[u8]) -> Encoding {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Encoding::Utf8Bom;
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return Encoding::Utf16Le;
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return Encoding::Utf16Be;
    }
    if std::str::from_utf8(bytes).is_ok() {
        return Encoding::Utf8;
    }
    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(bytes, true);
    Encoding::Ansi(detector.guess(None, true).name().to_lowercase())
}

/// 解码为字符串；ANSI 等无法映射的字节以替换字符容错（FR-14.6 由上层据此提示）。
pub fn decode(bytes: &[u8], enc: &Encoding) -> String {
    let bytes = match enc {
        Encoding::Utf8Bom => &bytes[3..],
        _ => bytes,
    };
    match enc {
        Encoding::Utf8 | Encoding::Utf8Bom => String::from_utf8_lossy(bytes).into_owned(),
        other => match other.rs() {
            Some(rs) => {
                let (text, _, _) = rs.decode(bytes);
                text.into_owned()
            }
            None => String::from_utf8_lossy(bytes).into_owned(),
        },
    }
}

/// 编码为字节流；UTF-8 BOM / UTF-16 自动补 BOM（FR-6.3）。
pub fn encode(text: &str, enc: &Encoding) -> Vec<u8> {
    match enc {
        Encoding::Utf8 => text.as_bytes().to_vec(),
        Encoding::Utf8Bom => {
            let mut out = vec![0xEF, 0xBB, 0xBF];
            out.extend_from_slice(text.as_bytes());
            out
        }
        Encoding::Utf16Le => {
            let mut out = vec![0xFF, 0xFE];
            for unit in text.encode_utf16() {
                out.extend_from_slice(&unit.to_le_bytes());
            }
            out
        }
        Encoding::Utf16Be => {
            let mut out = vec![0xFE, 0xFF];
            for unit in text.encode_utf16() {
                out.extend_from_slice(&unit.to_be_bytes());
            }
            out
        }
        Encoding::Ansi(label) => match RsEncoding::for_label(label.as_bytes()) {
            Some(rs) => {
                let (bytes, _, _) = rs.encode(text);
                bytes.into_owned()
            }
            None => text.as_bytes().to_vec(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_boms() {
        assert_eq!(detect(&[0xEF, 0xBB, 0xBF, b'a']), Encoding::Utf8Bom);
        assert_eq!(detect(&[0xFF, 0xFE, 0x41, 0x00]), Encoding::Utf16Le);
        assert_eq!(detect(&[0xFE, 0xFF, 0x00, 0x41]), Encoding::Utf16Be);
    }

    #[test]
    fn detects_valid_utf8() {
        assert_eq!(detect("中文 hello".as_bytes()), Encoding::Utf8);
    }

    #[test]
    fn falls_back_to_ansi_for_gbk() {
        // "中文" 的 GBK 编码字节。
        let gbk = [0xD6u8, 0xD0, 0xCE, 0xC4];
        match detect(&gbk) {
            Encoding::Ansi(label) => {
                assert!(label.contains("gb") || label.contains("big"), "got {label}")
            }
            other => panic!("expected Ansi, got {other:?}"),
        }
    }

    #[test]
    fn utf16_roundtrip() {
        let text = "中文 abc";
        let le = encode(text, &Encoding::Utf16Le);
        assert!(le.starts_with(&[0xFF, 0xFE]));
        assert_eq!(decode(&le, &Encoding::Utf16Le), text);
    }

    #[test]
    fn key_roundtrip() {
        for key in ["utf8", "utf8-bom", "utf16le", "utf16be", "gbk", "gb18030"] {
            let enc = Encoding::from_key(key).unwrap();
            assert_eq!(enc.key(), key);
        }
        // 旧 ansi: 前缀键兼容解析，并归一化为独立键
        assert_eq!(Encoding::from_key("ansi:gb18030").unwrap().key(), "gb18030");
        assert_eq!(
            Encoding::from_key("utf8-bom").unwrap().label(),
            "UTF-8 (BOM)"
        );
        assert_eq!(Encoding::from_key("gbk").unwrap().label(), "GBK");
    }
}
