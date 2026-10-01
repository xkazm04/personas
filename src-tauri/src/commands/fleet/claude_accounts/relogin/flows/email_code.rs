//! The emailed-code leg: a second Chrome session, on the INBOX profile, reads
//! the code that claude.ai emailed. The code is typed into the claude page by
//! the caller and zeroized when its [`MailSecret`] drops.

use std::path::PathBuf;

use crate::engine::login_lane::{LaneError, LaneMode, LaneSession};

use super::super::lane::LaneLauncher;
use super::super::ReloginReason;
use super::proton_inbox::{self, Baseline};
use super::{MailSecret, Timings, VaultReader};

/// Where the code arrives: the inbox profile, the vault login bound to it, and
/// the inbox URL (a parameter so a test can serve a fixture inbox).
pub struct InboxPlan<'a, L: LaneLauncher> {
    pub launcher: &'a L,
    /// `None` = the account has no code inbox linked.
    pub dir: Option<PathBuf>,
    pub vault: &'a dyn VaultReader,
    pub credential_id: Option<String>,
    pub url: &'a str,
}

/// An open inbox with its pre-request snapshot.
pub struct CodeReader<S> {
    session: S,
    baseline: Baseline,
    url: String,
}

impl<S: LaneSession> CodeReader<S> {
    /// Launch the inbox profile headless, sign in to Proton if it lapsed, and
    /// snapshot the inbox. Called BEFORE the sign-in email is requested, so a
    /// dead inbox fails the run before an email is sent for nothing.
    pub async fn open<L: LaneLauncher<Session = S>>(
        plan: &InboxPlan<'_, L>,
        t: &Timings,
    ) -> Result<Self, LaneError> {
        let Some(dir) = plan.dir.as_ref() else {
            return Err(LaneError::new(
                ReloginReason::CodeInboxNotLinked,
                "no code inbox linked",
            ));
        };
        let mut session = plan.launcher.launch(dir, LaneMode::Headless).await?;
        let login = plan
            .credential_id
            .as_deref()
            .and_then(|id| plan.vault.mail_login(id));
        match proton_inbox::open_inbox(&mut session, login, plan.url, t).await {
            Ok(baseline) => Ok(Self {
                session,
                baseline,
                url: plan.url.to_string(),
            }),
            Err(e) => {
                let _ = session.close().await;
                Err(e)
            }
        }
    }

    /// Wait for the new code (or sign-in link).
    pub async fn wait(&mut self, t: &Timings) -> Result<MailSecret, LaneError> {
        proton_inbox::read_code(&mut self.session, &self.url, &self.baseline, t).await
    }

    pub async fn close(self) {
        let _ = self.session.close().await;
    }
}
