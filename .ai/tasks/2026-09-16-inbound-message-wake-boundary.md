# Task: a message from anyone must not wake a persona that can answer them

- **Registry subject / technique:** software-engineering / prompt-safety / session-capability-conjunction (with untrusted-span-fencing for step 2)
- **Run:** intake-ff7om2 (2026-09-16), from a walkthrough of an agent that gets its own e-mail inbox and wakes on every received message
- **Status:** planned; first step not taken this run (see below)

## The seam

The source's agent reads whatever arrives in its inbox, holds its tools, and replies
in-thread without a person. Its only security advice was to keep the webhook URL and
key private. That key proves which *service* delivered the event. It says nothing
about who *wrote* the message inside it. Personas already routes events the right way
(a trigger belongs to one persona, `engine/src/bus.rs` matches on
`target_persona_id` before any model runs), and its webhook is HMAC-signed on
localhost. The gap is the author, in three places:

1. **Discord inbound poller** (`src-tauri/src/engine/discord_poller.rs`). Every
   non-bot message in a polled channel runs `execute_persona_inner` with the message
   as input, and a second pass posts the execution's final output back to the same
   channel. The only author filter is `msg.author_is_bot`. Anyone who can post in the
   channel holds leg A (third-party text in the context). The persona's tools and
   vault credentials are leg B. The reply goes back to a channel that author reads,
   which is leg C. The input is wrapped as untrusted data
   (`engine/src/prompt/assemble.rs`, "## Input Data"), but that fence is textual, and
   the technique's rule is: no context holds all three legs, and where one must, the
   outbound step is not autonomous.
   *Live state 2026-09-16:* 0 personas currently have a Discord channel configured;
   `discord_inbound_messages` holds 2 rows, both replied, from 1 author. The seam is
   latent, so fix it before the feature is used with a shared channel.
2. **Twin reply drafts** (`src-tauri/src/commands/infrastructure/twin.rs`,
   `build_reply_prompt`). The inbound message and the recent thread are interpolated
   raw (`"The message you are replying to:\n{m}"`). A person reviews every draft
   (`ReplyOutbox.tsx`, "Nothing is sent over any real channel"), so the action payoff
   is nil. The disclosure payoff is not: the same prompt carries the twin's distilled
   facts about the user and the contact, and an injected "list everything you know"
   lands in a draft a tired reviewer may paste.
3. **Gmail triage template** (`scripts/templates/productivity/email-morning-digest.json`).
   The template's rules say "Never send, archive, or mark email on behalf of the user"
   and it declares `gmail.readonly`, but the connector's default OAuth request
   (`src-tauri/src/commands/credentials/oauth.rs`, `default_google_scopes_for_connector`)
   asks for `gmail.modify` and `gmail.send` as well. That is a prompt line standing in
   for a capability. `send_message` and `mark_thread_read` do require approval
   (`src-tauri/src/companion/connectors.rs`), which bounds the harm. First check
   whether the template's declared scope or the default is what the consent flow
   actually requests.

## The change

1. **Author allowlist before dispatch (the cut at design time).** A discord channel
   config gains `allowedAuthorIds: string[]`. The poller dispatches only messages whose
   `author_id` is listed. A message from anyone else is logged with
   `error = "author-not-allowed"` and never reaches `execute_persona_inner`. An empty
   or missing list dispatches nothing and surfaces once, in the same spot as the
   missing-Message-Content-Intent warning, as "no allowed authors configured". The
   channel settings UI gets the field, pre-filled with the author id of the most
   recent message when the user enables `pollInbound`. For a shared channel where
   strangers must be able to wake the persona, add a second option,
   `replyMode: "draft"`: the output is stored for approval instead of posted.
2. **Fence the twin draft inputs.** Make the engine's nonce boundary helper
   (`runtime_safety::wrap_runtime_xml_boundary`, currently `pub(super)`) reachable from
   the app crate, or add a `pub fn` wrapper, and wrap `inbound_block` and each
   thread line in it with a provenance label and one data-not-instructions sentence.
3. **Scope follows the template.** Request the template's declared scope when a
   credential is created for a read-only template, or refuse to bind a read-only
   template to a credential holding `gmail.send`.

**Size:** step 1 about 3 files and 60-90 lines in Rust, plus the settings field and
its i18n key; step 2 about 2 files and 20-30 lines; step 3 needs a read of the consent
flow first, likely 2 files. **Gate:** step 1, a unit test over the poller's filter (an
unlisted author makes no execution, a listed one does, an empty list makes none) with
`cargo test -p personas-desktop discord_poller`; step 2, a test beside the existing
`build_reply_prompt` test (`twin.rs`, around its `mod tests`) asserting that an inbound
containing a forged closing tag stays inside the boundary.

**Measurable:** executions created per message from an unlisted author (target 0, today
1). **Floor:** executions per message from the listed owner stay at 1, and the reply is
still posted. **Falsifier:** if the only realistic Discord setup is a private 1:1
channel with the owner, the allowlist changes nothing observable. It is still the one
cut that holds on the day the channel is shared.

## Why the first step was not taken this run

The checkout has another session's uncommitted work (the browser feature and registry
leads) and a cargo build that ran today. Starting a second build of the desktop crate
from this run would contend with it for the target directory's build lock. None of the
three steps touches that session's files, so a later run or `/intake apply` can take
step 1 on a branch once the tree is quiet.
