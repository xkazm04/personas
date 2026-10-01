//! Google's side of "Continue with Google": only the account chooser is
//! automated. A password, 2-step or any challenge is a human's.

use crate::engine::login_lane::{LaneError, LaneSession};

/// Is this a Google sign-in page? Host first; the chooser's own heading is
/// also accepted so a local fixture needs no `accounts.google.com` host.
pub fn is_google(host: &str, lower_text: &str) -> bool {
    host == "accounts.google.com" || lower_text.contains("choose an account")
}

/// The chooser lists accounts; anything else on Google (an email or password
/// field, a consent screen) is not something to automate.
pub fn is_chooser(lower_text: &str) -> bool {
    lower_text.contains("choose an account")
}

/// Click the chooser entry for `email`. `Ok(false)` = that account is not
/// listed, so the profile is not signed in as it.
pub async fn pick_account<S: LaneSession>(session: &mut S, email: &str) -> Result<bool, LaneError> {
    session.click_text(email).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_the_chooser_and_google_host() {
        assert!(is_google("accounts.google.com", "sign in"));
        assert!(is_google(
            "127.0.0.1",
            "choose an account\nto continue to claude"
        ));
        assert!(!is_google("claude.ai", "continue with google"));
        assert!(is_chooser("choose an account"));
        assert!(!is_chooser("sign in\nemail or phone"));
    }
}
