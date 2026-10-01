//! Challenge detection over a page's URL and visible text. Pure, so the
//! orchestrator (WP1b) can call it after every navigation and the fixtures
//! below pin the markers.

use crate::commands::fleet::claude_accounts::relogin::ReloginReason;

/// Is the page a Cloudflare / captcha / Google interstitial a human must pass?
/// Order matters: a Cloudflare page may mention a captcha, a Google challenge
/// may embed reCAPTCHA, and the more specific reason wins.
pub fn detect_challenge(url: &str, text: &str) -> Option<ReloginReason> {
    let url = url.to_lowercase();
    // Curly apostrophes appear in Google's copy; fold them so one marker matches both.
    let text = text.to_lowercase().replace(['\u{2019}', '\u{2018}'], "'");

    if url.contains("/cdn-cgi/challenge")
        || text.contains("just a moment")
        || text.contains("verify you are human")
    {
        return Some(ReloginReason::CloudflareChallenge);
    }
    if url.contains("accounts.google.com/signin/challenge")
        || url.contains("accounts.google.com/v3/signin/challenge")
        || text.contains("verify it's you")
        || text.contains("confirm your recovery")
        || text.contains("this browser or app may not be secure")
    {
        return Some(ReloginReason::GoogleChallenge);
    }
    if text.contains("recaptcha")
        || text.contains("hcaptcha")
        || text.contains("h-captcha")
        || text.contains("i'm not a robot")
    {
        return Some(ReloginReason::Captcha);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cloudflare_markers() {
        assert_eq!(
            detect_challenge("https://claude.ai/login", "Just a moment..."),
            Some(ReloginReason::CloudflareChallenge)
        );
        assert_eq!(
            detect_challenge("https://claude.ai/", "Verify you are human by completing"),
            Some(ReloginReason::CloudflareChallenge)
        );
        assert_eq!(
            detect_challenge("https://claude.ai/cdn-cgi/challenge-platform/h/b", ""),
            Some(ReloginReason::CloudflareChallenge)
        );
    }

    #[test]
    fn google_markers_including_curly_apostrophe() {
        assert_eq!(
            detect_challenge("https://accounts.google.com/x", "Verify it\u{2019}s you"),
            Some(ReloginReason::GoogleChallenge)
        );
        assert_eq!(
            detect_challenge(
                "https://accounts.google.com/x",
                "Confirm your recovery email"
            ),
            Some(ReloginReason::GoogleChallenge)
        );
        assert_eq!(
            detect_challenge(
                "https://accounts.google.com/x",
                "This browser or app may not be secure."
            ),
            Some(ReloginReason::GoogleChallenge)
        );
        assert_eq!(
            detect_challenge("https://accounts.google.com/signin/challenge/pwd", "x"),
            Some(ReloginReason::GoogleChallenge)
        );
    }

    #[test]
    fn captcha_markers() {
        assert_eq!(
            detect_challenge("https://claude.ai/login", "protected by reCAPTCHA"),
            Some(ReloginReason::Captcha)
        );
        assert_eq!(
            detect_challenge("https://claude.ai/login", "hCaptcha widget"),
            Some(ReloginReason::Captcha)
        );
    }

    #[test]
    fn ordinary_pages_are_not_challenges() {
        assert_eq!(
            detect_challenge(
                "https://claude.ai/login",
                "Continue with Google\nEnter your email\nVerify your email address"
            ),
            None
        );
        assert_eq!(
            detect_challenge("https://mail.proton.me/u/0/inbox", "Inbox (3)"),
            None
        );
        assert_eq!(detect_challenge("", ""), None);
    }
}
