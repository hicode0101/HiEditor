//! Windows 系统打印（FR-2.11）。
//!
//! 调用 comdlg32 的 PrintDlgEx —— 与记事本相同的"从 Win32 应用程序打印"公共对话框；
//! 用户确认后（PD_RETURNDC 拿到打印机 DC），按 GDI 分页把文档绘制到打印机。
//! 分页：等宽 Consolas 10pt、按字符宽度贪心折行（CJK 友好）、页高按行高计算。

use std::collections::HashMap;
use windows::core::{w, HSTRING, PCWSTR};
use windows::Win32::Foundation::{GlobalFree, HGLOBAL, HWND, SIZE};
use windows::Win32::Graphics::Gdi::{
    CreateFontW, DeleteObject, GetDeviceCaps, GetTextExtentPoint32W,
    GetTextMetricsW, SelectObject, TextOutW, CLEARTYPE_QUALITY,
    CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET, DEFAULT_PITCH, FF_DONTCARE, FW_NORMAL, HDC,
    HGDIOBJ, HORZRES, LOGPIXELSY, OUT_DEFAULT_PRECIS, TEXTMETRICW, VERTRES,
};
use windows::Win32::Storage::Xps::{EndDoc, EndPage, StartDocW, StartPage, DOCINFOW};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Controls::Dialogs::{
    PrintDlgExW, PD_PAGENUMS, PD_RETURNDC, PD_RESULT_PRINT, PRINTDLGEXW, PRINTPAGERANGE,
};

pub fn show_print_dialog(owner: HWND, doc_name: &str, text: String) -> Result<String, String> {
    unsafe {
        // PrintDlgEx 需要 COM；已在 STA 时忽略返回值。
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        let mut pd: PRINTDLGEXW = std::mem::zeroed();
        pd.lStructSize = std::mem::size_of::<PRINTDLGEXW>() as u32;
        pd.hwndOwner = owner;
        pd.Flags = PD_RETURNDC;
        let mut page_range = PRINTPAGERANGE {
            nFromPage: 1,
            nToPage: 9999,
        };
        pd.lpPageRanges = &mut page_range;
        pd.nMaxPageRanges = 1;
        pd.nMinPage = 1;
        pd.nMaxPage = 9999;
        pd.nStartPage = 0xFFFF_FFFF; // START_PAGE_GENERAL

        let hr = PrintDlgExW(&mut pd);
        if let Err(e) = hr {
            return Err(format!("无法打开打印对话框（{e}）"));
        }
        if pd.hDevMode.0.is_null() {
            let _ = GlobalFree(pd.hDevMode);
        }
        if pd.hDevNames.0.is_null() {
            let _ = GlobalFree(pd.hDevNames);
        }

        if pd.dwResultAction != PD_RESULT_PRINT {
            return Ok("cancelled".into());
        }
        if pd.hDC.is_invalid() {
            return Err("未能获取打印机设备上下文".into());
        }

        let range = if pd.Flags.0 & PD_PAGENUMS.0 != 0 && pd.nPageRanges >= 1 {
            Some((page_range.nFromPage, page_range.nToPage))
        } else {
            None
        };
        draw_and_print(pd.hDC, doc_name, &text, range)
            .map(|pages| format!("已发送 {pages} 页到打印机"))
    }
}

unsafe fn draw_and_print(
    hdc: HDC,
    doc_name: &str,
    text: &str,
    range: Option<(u32, u32)>,
) -> Result<usize, String> {
    let dpi = GetDeviceCaps(hdc, LOGPIXELSY).max(1);
    let font_h = -(10 * dpi + 36) / 72; // 10pt
    let hfont = CreateFontW(
        font_h,
        0,
        0,
        0,
        FW_NORMAL.0 as i32,
        0,
        0,
        0,
        DEFAULT_CHARSET.0 as u32,
        OUT_DEFAULT_PRECIS.0 as u32,
        CLIP_DEFAULT_PRECIS.0 as u32,
        CLEARTYPE_QUALITY.0 as u32,
        (DEFAULT_PITCH.0 | FF_DONTCARE.0) as u32,
        w!("Consolas"),
    );
    if hfont.is_invalid() {
        return Err("创建打印字体失败".into());
    }
    let old_font = SelectObject(hdc, HGDIOBJ(hfont.0));

    let mut tm = TEXTMETRICW::default();
    if !GetTextMetricsW(hdc, &mut tm).as_bool() {
        SelectObject(hdc, old_font);
        DeleteObject(HGDIOBJ(hfont.0));
        return Err("获取字体度量失败".into());
    }
    let line_h = (tm.tmHeight + tm.tmExternalLeading).max(1) as i32;
    let page_w = GetDeviceCaps(hdc, HORZRES).max(1);
    let page_h = GetDeviceCaps(hdc, VERTRES).max(1);
    let lines_per_page = (page_h / line_h).max(1) as usize;

    // 折行：Tab 展开为 4 空格，按字符宽度贪心换行
    let expanded = text.replace('\t', "    ");
    let mut cache: HashMap<char, i32> = HashMap::new();
    let mut segments: Vec<Vec<u16>> = Vec::new();
    for line in expanded.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        segments.extend(wrap_line(hdc, line, page_w, &mut cache));
    }
    if segments.is_empty() {
        segments.push(Vec::new());
    }
    let total_pages = segments.len().div_ceil(lines_per_page);

    let (first, last) = match range {
        Some((f, t)) => {
            let f = (f as usize).max(1).min(total_pages);
            let t = (t as usize).max(f).min(total_pages);
            (f - 1, t - 1)
        }
        None => (0, total_pages - 1),
    };

    let name_h: HSTRING = doc_name.into();
    let di = DOCINFOW {
        cbSize: std::mem::size_of::<DOCINFOW>() as i32,
        lpszDocName: PCWSTR(name_h.as_ptr()),
        lpszOutput: PCWSTR::null(),
        lpszDatatype: PCWSTR::null(),
        fwType: 0,
    };
    if StartDocW(hdc, &di) <= 0 {
        SelectObject(hdc, old_font);
        DeleteObject(HGDIOBJ(hfont.0));
        return Err("StartDoc 失败".into());
    }

    let mut sent = 0usize;
    for page in first..=last {
        if StartPage(hdc) <= 0 {
            EndDoc(hdc);
            SelectObject(hdc, old_font);
            DeleteObject(HGDIOBJ(hfont.0));
            return Err("StartPage 失败".into());
        }
        SelectObject(hdc, HGDIOBJ(hfont.0)); // 每页 DC 状态会重置
        let segs = &segments[page * lines_per_page..((page + 1) * lines_per_page).min(segments.len())];
        for (i, seg) in segs.iter().enumerate() {
            if seg.len() > 1 {
                TextOutW(hdc, 0, i as i32 * line_h, &seg[..seg.len() - 1]);
            }
        }
        if EndPage(hdc) <= 0 {
            EndDoc(hdc);
            SelectObject(hdc, old_font);
            DeleteObject(HGDIOBJ(hfont.0));
            return Err("EndPage 失败".into());
        }
        sent += 1;
    }
    EndDoc(hdc);

    SelectObject(hdc, old_font);
    DeleteObject(HGDIOBJ(hfont.0));
    Ok(sent)
}

unsafe fn wrap_line(
    hdc: HDC,
    line: &str,
    max_w: i32,
    cache: &mut HashMap<char, i32>,
) -> Vec<Vec<u16>> {
    if line.is_empty() {
        return vec![vec![0]]; // 仅含零终止符的空行
    }
    let mut segs: Vec<Vec<u16>> = Vec::new();
    let mut cur: Vec<u16> = Vec::new();
    let mut width = 0i32;
    for ch in line.chars() {
        let cw = *cache.entry(ch).or_insert_with(|| measure_char(hdc, ch));
        if width + cw > max_w && !cur.is_empty() {
            cur.push(0); // 零终止符，供 TextOutW 使用
            segs.push(std::mem::take(&mut cur));
            width = 0;
        }
        let mut enc = [0u16; 2];
        let encoded = ch.encode_utf16(&mut enc);
        cur.extend_from_slice(encoded);
        width += cw;
    }
    cur.push(0);
    segs.push(cur);
    segs
}

unsafe fn measure_char(hdc: HDC, ch: char) -> i32 {
    let mut enc = [0u16; 2];
    let encoded = ch.encode_utf16(&mut enc);
    let mut sz = SIZE { cx: 0, cy: 0 };
    let _ = GetTextExtentPoint32W(hdc, encoded, &mut sz);
    if sz.cx <= 0 { 1 } else { sz.cx }
}
