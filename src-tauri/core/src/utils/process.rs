//! Spawning a child process without a console window on the operator's desktop.
//!
//! A console program started from a GUI process (or from one with no console at all) gets a
//! NEW, visible console window unless `CREATE_NO_WINDOW` is passed. Every spawn site in this
//! workspace that forgot it flashed a conhost, and more than twenty sites each declared the
//! flag themselves (`0x0800_0000`, or `0x08000000`, with or without a named const).
//! Measured 2026-10-13 from the other side: a detached driver with no console made every
//! child it started open a visible window - the operator saw a stream of them all afternoon.
//!
//! `no_window()` sets ONLY `CREATE_NO_WINDOW`, replacing any flags set before it: Windows'
//! `creation_flags` is a setter, not an `|=`. A site that needs another flag as well
//! (`CREATE_NEW_PROCESS_GROUP`, `DETACHED_PROCESS`) composes them itself with
//! [`CREATE_NO_WINDOW`] - this helper is for the common case, not for every case.

/// `CREATE_NO_WINDOW`: the child gets a console that has no window, inherited by its own
/// children, so nothing below it opens one either.
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Start this command without a console window on Windows; a no-op elsewhere.
pub trait NoWindow {
    fn no_window(&mut self) -> &mut Self;
}

impl NoWindow for std::process::Command {
    fn no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }
}

impl NoWindow for tokio::process::Command {
    fn no_window(&mut self) -> &mut Self {
        // An inherent method on tokio's Command - no CommandExt import.
        #[cfg(windows)]
        self.creation_flags(CREATE_NO_WINDOW);
        self
    }
}

/// Decode a child's captured stdout or stderr into text, line by line.
///
/// `String::from_utf8_lossy` is right for tools that write UTF-8 and wrong for the ones that do
/// not: on Windows, `cmd` builtins (`echo`, `dir`, `type`) and many native tools write in the
/// console's OEM code page. Measured 2026-10-14 on a cs-CZ machine (OEM 852, ANSI 1250) from a
/// parent with no console: `cmd /C echo Žluťoučký` arrived as `A6 6C 75 9C 6F 75 9F 6B EC`, and
/// the lossy decode replaced four of its nine letters with U+FFFD. Decoding the whole buffer in
/// the OEM page is the obvious fix and the wrong one: a step that runs `node` and then `dir`
/// writes UTF-8 lines and OEM lines into one stream, and an OEM decode mangles the UTF-8 half.
///
/// So the unit is the line. A buffer that is valid UTF-8 is returned as is - every run on a
/// UTF-8 toolchain takes only that path, so nothing changes for it. Otherwise a line that is
/// valid UTF-8 is kept, a line that is not is decoded in the legacy code page when that decode
/// is error-free, and anything left keeps the lossy decode it had before. A legacy line that
/// happens to be valid UTF-8 is read as UTF-8; per line that is rare, per buffer it was the rule.
pub fn decode_output(bytes: &[u8]) -> String {
    decode_output_with(bytes, legacy_decode)
}

/// [`decode_output`] with the legacy decoder passed in, so the line walk compiles and is tested
/// on every platform; only the code-page lookup is Windows-specific.
fn decode_output_with(bytes: &[u8], legacy: impl Fn(&[u8]) -> Option<String>) -> String {
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_owned();
    }
    let mut out = String::with_capacity(bytes.len());
    for line in bytes.split_inclusive(|&b| b == b'\n') {
        match std::str::from_utf8(line) {
            Ok(text) => out.push_str(text),
            Err(_) => match legacy(line) {
                Some(text) => out.push_str(&text),
                None => out.push_str(&String::from_utf8_lossy(line)),
            },
        }
    }
    out
}

/// Decode in the code page a console child writes in, as seen from this process.
///
/// A GUI process has no console, so `GetConsoleOutputCP` returns 0 here, and a child started
/// with [`CREATE_NO_WINDOW`] (or with a console of its own) writes in the system OEM code page,
/// which is what `GetOEMCP` returns. A console parent's own page wins when there is one.
#[cfg(windows)]
fn legacy_decode(bytes: &[u8]) -> Option<String> {
    // SAFETY: both calls take no arguments and only read process or system state.
    let code_page = match unsafe { windows::Win32::System::Console::GetConsoleOutputCP() } {
        0 => unsafe { windows::Win32::Globalization::GetOEMCP() },
        cp => cp,
    };
    decode_code_page(bytes, code_page)
}

#[cfg(not(windows))]
fn legacy_decode(_bytes: &[u8]) -> Option<String> {
    // Outside Windows there is no console code page to consult.
    None
}

/// Decode `bytes` in Windows code page `code_page`, or `None` if they are not valid in it.
#[cfg(windows)]
fn decode_code_page(bytes: &[u8], code_page: u32) -> Option<String> {
    use windows::Win32::Globalization::{MultiByteToWideChar, MB_ERR_INVALID_CHARS};
    if bytes.is_empty() {
        return Some(String::new());
    }
    // SAFETY: `bytes` is a valid slice and no output buffer is passed, so the call only reports
    // the UTF-16 length it needs - 0 for an invalid sequence or an unknown code page.
    let len = unsafe { MultiByteToWideChar(code_page, MB_ERR_INVALID_CHARS, bytes, None) };
    if len <= 0 {
        return None;
    }
    let mut wide = vec![0u16; len as usize];
    // SAFETY: `wide` holds exactly the `len` units the sizing call asked for.
    let written =
        unsafe { MultiByteToWideChar(code_page, MB_ERR_INVALID_CHARS, bytes, Some(&mut wide)) };
    if written != len {
        return None;
    }
    String::from_utf16(&wide).ok()
}

/// Whether the shell that ran a command string reported that the program never started.
///
/// A caller that parses a value out of a shell command's output cannot tell "the tool ran and
/// found nothing" from "the tool was never there" by parsing: the shell's own message is output
/// too. Measured 2026-10-14 with the program missing: `sh -c "tool . | wc -l"` exits 0 with `0`
/// on stdout, so a first-number parse records zero findings; `sh -c "tool ."` exits 127 and the
/// first number in its message is the `1` of `line 1`; `cmd /C` exits 1 - the same code a lint
/// tool uses for "errors found" - so on Windows the exit code says nothing either way.
///
/// So the evidence is the shell's line on stderr, plus POSIX's reserved 126/127 off Windows.
/// cmd's message follows the Windows display language and only the English one is recognised
/// here; a tool that starts and then fails (a package registry's 404, a crash) is not "did not
/// run" and is not caught by this check.
pub fn shell_reported_not_run(exit_code: Option<i32>, stderr: &str) -> bool {
    if !cfg!(windows) && matches!(exit_code, Some(126 | 127)) {
        return true;
    }
    stderr.lines().any(|line| {
        let line = line.trim();
        line.contains("is not recognized as an internal or external command")
            || (["sh:", "bash:", "dash:", "zsh:"]
                .iter()
                .any(|shell| line.starts_with(shell))
                && line.contains("not found"))
    })
}

// No unit test spawns a process here: the census counts every `Command::new` outside the
// subprocess chokepoint, tests included, and this helper is exercised by its five call sites
// (connector_readiness, drive reveal, devserver kill_tree/pid_is_node, bun). The flag value is
// the one thing a test can pin without a spawn.
#[cfg(test)]
mod tests {
    #[test]
    fn the_flag_is_windows_create_no_window() {
        assert_eq!(super::CREATE_NO_WINDOW, 0x0800_0000);
    }

    #[test]
    fn utf8_output_is_returned_unchanged() {
        let text = "plain\nutf8: Žluťoučký kůň\r\n";
        let decoded =
            super::decode_output_with(text.as_bytes(), |_| panic!("UTF-8 needs no legacy page"));
        assert_eq!(decoded, text);
    }

    #[test]
    fn only_lines_that_are_not_utf8_reach_the_legacy_decoder() {
        // Latin-1 stands in for the console page so this runs on every platform.
        let latin1 = |b: &[u8]| Some(b.iter().map(|&c| c as char).collect::<String>());
        let mut bytes = "node: Žluťoučký\n".as_bytes().to_vec();
        bytes.extend_from_slice(b"caf\xe9\r\n");
        assert_eq!(
            super::decode_output_with(&bytes, latin1),
            "node: Žluťoučký\ncafé\r\n"
        );
    }

    #[test]
    fn a_line_the_legacy_page_rejects_keeps_the_lossy_decode() {
        assert_eq!(
            super::decode_output_with(b"ok\n\xff\n", |_| None),
            "ok\n\u{fffd}\n"
        );
    }

    /// The bytes `cmd /C echo Žluťoučký` produced under a console-less parent on a cs-CZ machine
    /// (OEM 852), measured 2026-10-14, alone and after a UTF-8 tool's line in the same stream.
    #[cfg(windows)]
    #[test]
    fn oem_852_output_keeps_the_letters_the_lossy_decode_lost() {
        const CMD_ECHO: &[u8] = b"\xa6lu\x9cou\x9fk\xec\r\n";
        // Before: the lossy decode replaces four of the nine letters.
        assert_eq!(
            String::from_utf8_lossy(CMD_ECHO)
                .matches('\u{fffd}')
                .count(),
            4
        );
        // After: every letter survives, and a UTF-8 line in the same stream is left alone.
        assert_eq!(
            super::decode_code_page(CMD_ECHO, 852).as_deref(),
            Some("Žluťoučký\r\n")
        );
        let mut mixed = "node: Žluťoučký\n".as_bytes().to_vec();
        mixed.extend_from_slice(CMD_ECHO);
        let decoded = super::decode_output_with(&mixed, |b| super::decode_code_page(b, 852));
        assert_eq!(decoded, "node: Žluťoučký\nŽluťoučký\r\n");
    }

    // stderr exactly as captured 2026-10-14 with the program missing.
    const CMD_NOT_RECOGNIZED: &str = "'eslintx_not_installed' is not recognized as an internal \
        or external command,\r\noperable program or batch file.\r\n";
    const SH_NOT_FOUND: &str = "sh: line 1: eslintx_not_installed: command not found\n";

    #[test]
    fn a_missing_program_is_reported_whatever_the_exit_code() {
        use super::shell_reported_not_run as not_run;
        assert!(not_run(Some(1), CMD_NOT_RECOGNIZED), "cmd /C tool .");
        assert!(
            not_run(Some(255), CMD_NOT_RECOGNIZED),
            "cmd /C tool . | find /c /v \"\""
        );
        assert!(
            not_run(Some(0), SH_NOT_FOUND),
            "sh -c 'tool . | wc -l' exits 0, stdout 0"
        );
        assert!(not_run(Some(127), SH_NOT_FOUND), "sh -c 'tool .'");
        assert!(
            not_run(Some(0), "sh: 1: eslint: not found\n"),
            "dash's spelling"
        );
    }

    #[test]
    fn a_program_that_ran_is_not_reported() {
        use super::shell_reported_not_run as not_run;
        assert!(!not_run(Some(1), ""), "a linter that found errors");
        assert!(
            !not_run(Some(2), "error: config file not found\n"),
            "the tool's own not-found"
        );
        assert!(
            !not_run(Some(1), "npm error code E404\nnpm error 404 Not Found\n"),
            "ran, failed"
        );
    }
}
