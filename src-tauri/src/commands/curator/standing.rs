//! Her standing lane: the two rungs she runs when the operator's queue and her
//! own plan are both empty, and the measurement that chooses between them.
//!
//! ## Why there are two rungs, and what it cost to learn
//!
//! The lane shipped with ONE rung - `/harvest research` - on the reasoning that
//! harvest's refill "is a generator that cannot come up empty", so a lane whose
//! job is that she never idles could be built on it. The first real dispatch,
//! 2026-09-24, refuted that from inside the registry:
//!
//! > "The `/harvest research` refill found no work, so it dispatched no
//! > research agents. **Why:** a refill only runs when the queue is running low
//! > or a domain has no queued rows left. I recounted at `88bff378`. There are
//! > **268 queued rows**, and every one of the ten sections still has some. …
//! > This is the **eighth refill in a row today with nothing to do**."
//!
//! Verified: `librarian/harvest/queue.md` held 268 `queued` rows and
//! `librarian/runs/` held `hr-idle-0924` through `hr-idle8-0924`. Each of those
//! passes cost about $0.26 and a minute to discover it had nothing to do,
//! against a daily budget that is her only brake.
//!
//! The error was a category one. **`/harvest research` REFILLS the queue; it is
//! `/harvest auto` that CONSUMES it** - "one unattended pass: only
//! self-authorizing outcomes land", the mode harvest wrote for a machine
//! caller. The never-idle ladder was reaching for the refill where it should
//! have reached for the drain. So:
//!
//! | rung | invocation | when |
//! |---|---|---|
//! | 3 | `/harvest auto` | the lane can furnish a batch |
//! | 4 | `/harvest research` | it cannot, or the last drain moved nothing |
//!
//! ## Both gates are measurements taken here, from the registry's own file
//!
//! Nothing below infers the lane's state from a previous run's outcome. The
//! queue file IS the state, this app can read it, and a gate that reads its
//! subject is the only kind that can contradict a worker with evidence - which
//! is how this module came to exist.
//!
//! ## The unchanged-inputs brake
//!
//! Eight no-op dispatches in a row is not a loop that found nothing; it is a
//! loop that never looked. The worker that found the bug did the cheap check by
//! hand - "queue.md and coverage-gaps.md haven't changed since `d9a07b05`" - so
//! that check belongs in front of the dispatch rather than inside the $0.26 the
//! dispatch spends.
//!
//! **A rung is not re-dispatched while the file it exists to WRITE is
//! byte-identical to what it was when that rung last ran.** Both rungs write
//! `queue.md`: the drain flips row statuses (`mined`, `parked`), the refill
//! appends rows. A pass that left it untouched changed nothing the lane is
//! about, whatever it reported, and running it again against the same bytes
//! buys the same nothing.
//!
//! `coverage-gaps.md` is deliberately NOT part of the mark, and that is the one
//! subtle decision here. A refill that honestly finds no elite source still
//! writes a `nearest stand-in` line into the gap list - harvest says so
//! explicitly - so a mark that included it would be re-armed by the very pass
//! it is meant to stop, and the eight-in-a-row would come straight back.
//!
//! The two marks unstick each other: a drain that mines rows moves `queue.md`
//! and so re-arms the refill, and a refill that appends rows re-arms the drain.
//! Both stay blocked only when the lane is genuinely inert, and any hand at
//! all - a human editing the queue, another lane's worker committing into it -
//! re-arms both.

use std::path::Path;

use crate::error::AppError;

/// The smallest batch harvest will form: "Phase 2 - batch: one domain, four to
/// eight rows". A section that cannot furnish four rows cannot be the next
/// batch, so a lane where NO section can is a lane the drain has nothing to do
/// in - which is the refill's trigger, stated as harvest states it.
const MIN_BATCH: u32 = 4;

/// The lane's own file, relative to the registry checkout.
const QUEUE_PATH: [&str; 3] = ["librarian", "harvest", "queue.md"];

/// What `queue.md` says right now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct HarvestLane {
    /// Rows whose status is `queued`, across every section.
    ///
    /// `batched` is deliberately not counted with them: a batched row is one a
    /// previous pass already claimed for its own run, so counting it as
    /// available would let two passes plan the same row.
    pub queued: u32,
    /// One entry per `## ` heading, in file order.
    pub sections: Vec<LaneSection>,
    /// Content identity of the file, for the unchanged-inputs brake. `absent`
    /// when there is no file at all, which is a real state for a fresh registry
    /// and reads as an empty lane.
    pub fingerprint: String,
}

/// One `## ` section of the queue - harvest's "domain", and the unit a batch is
/// formed from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct LaneSection {
    pub name: String,
    pub queued: u32,
    pub rows: u32,
}

impl HarvestLane {
    /// The largest section by queued rows, which is the batch the drain would
    /// form next.
    fn best_section(&self) -> Option<&LaneSection> {
        self.sections.iter().max_by_key(|s| s.queued)
    }

    /// Why the drain has nothing to do here, or `None` when it has.
    ///
    /// **This is the 3 -> 4 gate**, and it is harvest's own sentence measured
    /// rather than guessed: a batch is four to eight rows from ONE domain, so a
    /// lane where no domain holds four is a lane `/harvest auto` cannot batch
    /// from, however many rows it holds in total.
    ///
    /// Harvest also names "a domain's rows are all terminal" as a refill
    /// trigger, and that clause is deliberately folded into this one rather
    /// than added beside it. Firing on an exhausted section while another
    /// section still holds fifty minable rows would put the refill AHEAD of the
    /// drain, which is the operator's lane order reversed; an exhausted section
    /// reaches the refill by this rule as soon as the fat one thins.
    pub(super) fn thin(&self) -> Option<String> {
        // A row is only ever counted inside a section, so a non-zero `queued`
        // always has a section to name and this `else` is the empty-lane arm.
        let Some(best) = self.best_section().filter(|best| best.queued > 0) else {
            return Some(if self.sections.is_empty() {
                "the queue file carries no section at all".to_string()
            } else {
                "not one row in the queue is still `queued`".to_string()
            });
        };
        (best.queued < MIN_BATCH).then(|| {
            format!(
                "{} rows are queued but no section can furnish a batch of {MIN_BATCH} - the \
                 fullest is '{}' with {} of its {} still queued",
                self.queued, best.name, best.queued, best.rows
            )
        })
    }

    /// The sentence the drain's brief carries, so the worker can see the count
    /// this app dispatched it on and contradict it with evidence if it is
    /// wrong.
    pub(super) fn drainable_sentence(&self) -> String {
        match self.best_section() {
            Some(best) => format!(
                "{} rows are queued across {} sections; the fullest is '{}' with {} of its {} \
                 still queued",
                self.queued,
                self.sections.len(),
                best.name,
                best.queued,
                best.rows
            ),
            None => format!("{} rows are queued", self.queued),
        }
    }
}

/// Read the lane from the registry checkout.
///
/// The two absences are kept apart, exactly as `instrument::applied_subjects`
/// keeps them apart for the applied ledger: a file that is NOT THERE is an
/// empty lane (a fresh registry has queued nothing - a real answer), while a
/// file that cannot be READ is an error, because dispatching either rung on a
/// guess is how this module's subject matter went wrong in the first place.
pub(super) fn read(registry_root: &Path) -> Result<HarvestLane, AppError> {
    let mut path = registry_root.to_path_buf();
    for part in QUEUE_PATH {
        path.push(part);
    }
    let raw = match std::fs::read(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(HarvestLane {
                queued: 0,
                sections: Vec::new(),
                fingerprint: "absent".into(),
            })
        }
        Err(e) => {
            return Err(AppError::Internal(format!(
                "curator: the harvest queue at {} could not be read: {e}",
                path.display()
            )))
        }
    };
    let fingerprint = fingerprint(&raw);
    let text = String::from_utf8_lossy(&raw);
    Ok(parse(&text, fingerprint))
}

/// Content identity of the queue file.
///
/// A digest rather than a length or an mtime: a status flipped from `queued` to
/// `parked` is the same byte count, and a checkout that is re-cloned or touched
/// by a merge moves every mtime without moving a row.
fn fingerprint(raw: &[u8]) -> String {
    use sha2::Digest as _;
    let mut hasher = sha2::Sha256::new();
    hasher.update(raw);
    let digest = hasher.finalize();
    digest
        .iter()
        .take(FINGERPRINT_BYTES)
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// How many leading bytes of the SHA-256 digest the fingerprint keeps - sixteen
/// hex characters. This is an identity check against a value this app wrote
/// itself minutes ago, not a security boundary. Must not exceed the digest's 32
/// bytes, or the fingerprint silently stops growing with the constant.
const FINGERPRINT_BYTES: usize = 8;
const _: () = assert!(FINGERPRINT_BYTES <= 32);

/// Parse the queue's markdown into sections and their `queued` counts.
///
/// Split out and tested against the registry's real file because the whole
/// ladder now turns on this count: a parser that silently matched nothing would
/// read as an empty queue, which is the state that dispatches the refill - the
/// exact bug this module exists to stop, reintroduced one layer down.
fn parse(text: &str, fingerprint: String) -> HarvestLane {
    let mut sections: Vec<LaneSection> = Vec::new();
    let mut queued = 0u32;
    for line in text.lines() {
        let line = line.trim();
        if let Some(heading) = line.strip_prefix("## ") {
            sections.push(LaneSection {
                name: heading.trim().to_string(),
                queued: 0,
                rows: 0,
            });
            continue;
        }
        if !line.starts_with('|') {
            continue;
        }
        let Some(status) = status_cell(line) else {
            continue;
        };
        let Some(section) = sections.last_mut() else {
            // A row above the first heading is not in any domain, so it can
            // never be batched; counted nowhere rather than into a section it
            // is not in.
            continue;
        };
        section.rows += 1;
        // `mined: 2c/1cur/…` and `parked: <reason>` carry their detail in the
        // same cell, so the status is the word before the colon.
        if status.split(':').next().map(str::trim) == Some("queued") {
            section.queued += 1;
            queued += 1;
        }
    }
    HarvestLane {
        queued,
        sections,
        fingerprint,
    }
}

/// The parser, for `tick`'s own tests.
///
/// Exposed rather than duplicated so the ladder's tests and this module's tests
/// read the SAME registry file through the SAME parse: a second hand-built
/// fixture would let the two drift and each keep passing.
#[cfg(test)]
pub(super) fn parse_for_test(text: &str, fingerprint: &str) -> HarvestLane {
    parse(text, fingerprint.to_string())
}

/// The last cell of a queue row, or `None` for the header and the `| --- |`
/// rule, which occupy the same shape.
fn status_cell(line: &str) -> Option<&str> {
    let cells: Vec<&str> = line.split('|').collect();
    // `['', id, …, status, '']` - a row with fewer cells than the header's nine
    // is a truncated line, not a row.
    if cells.len() < 4 {
        return None;
    }
    let status = cells.get(cells.len() - 2).map(|c| c.trim())?;
    if status.is_empty()
        || status.eq_ignore_ascii_case("status")
        || status.chars().all(|c| c == '-' || c == ':')
    {
        return None;
    }
    // The first cell after the leading pipe is the row id; a header or rule
    // never carries one that looks like `SEA-001`.
    let id = cells.get(1).map(|c| c.trim()).unwrap_or_default();
    if id.is_empty() || id.eq_ignore_ascii_case("id") || id.chars().all(|c| c == '-' || c == ':') {
        return None;
    }
    Some(status)
}

// ---------------------------------------------------------------------------
// The two rungs
// ---------------------------------------------------------------------------

/// Which standing rung a tick reaches for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Rung {
    /// `/harvest auto` - drain the standing queue.
    Drain,
    /// `/harvest research` - refill it.
    Refill,
}

/// The marks the last run of each rung left, read from `app_settings`.
///
/// Persisted rather than held in a process static so an app restart does not
/// hand the loop a clean slate and buy back the first no-op dispatch of each
/// rung - the cheapest possible way to reintroduce the charge this module
/// exists to stop.
#[derive(Debug, Default, Clone)]
pub(super) struct Marks {
    pub drain: Option<String>,
    pub refill: Option<String>,
}

/// One chosen rung and the measurement that chose it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Standing {
    pub rung: Rung,
    /// Carried into the worker's brief verbatim.
    pub because: String,
    /// The queue fingerprint this rung is being dispatched against. Written to
    /// the rung's mark at dispatch, so a pass that leaves the file alone cannot
    /// be handed the same bytes again.
    pub mark: String,
}

/// **The ladder's third and fourth rungs.** Pure, so the whole decision is
/// driven in tests against the registry's own numbers rather than against an
/// idea of them.
///
/// Returns `None` when neither rung can honestly be dispatched. That is not her
/// idling by choice: it is both rungs having been run against exactly these
/// bytes and neither having moved them, which is the one state where another
/// dispatch is a charge with a known-zero return. It clears the moment anything
/// touches the queue - a human, a worker in another lane, the next refill after
/// somebody adds a gap - so it is a brake, not a stop.
pub(super) fn standing_rung(lane: &HarvestLane, marks: &Marks) -> Option<Standing> {
    let fp = lane.fingerprint.as_str();
    let drain_barren = marks.drain.as_deref() == Some(fp);
    let refill_barren = marks.refill.as_deref() == Some(fp);

    // Rung 3 - drain. The queue is not thin, so `/harvest auto` has a batch to
    // form, and the last drain is not known to have left these same bytes.
    let thin = lane.thin();
    if thin.is_none() && !drain_barren {
        return Some(Standing {
            rung: Rung::Drain,
            because: lane.drainable_sentence(),
            mark: fp.to_string(),
        });
    }

    // Rung 4 - refill, for one of two measured reasons, and never against
    // bytes a refill has already been run at.
    if refill_barren {
        return None;
    }
    let because = match thin {
        Some(why) => why,
        // Not thin, so the drain was the rung that was skipped, and the only
        // thing that can have skipped it is its own mark.
        None => format!(
            "{} rows are queued, but the last drain left the queue byte-identical, so its rows \
             are ahead of what the corpus can absorb",
            lane.queued
        ),
    };
    Some(Standing {
        rung: Rung::Refill,
        because,
        mark: fp.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lane(fingerprint: &str, sections: &[(&str, u32, u32)]) -> HarvestLane {
        let sections: Vec<LaneSection> = sections
            .iter()
            .map(|(name, queued, rows)| LaneSection {
                name: (*name).into(),
                queued: *queued,
                rows: *rows,
            })
            .collect();
        HarvestLane {
            queued: sections.iter().map(|s| s.queued).sum(),
            sections,
            fingerprint: fingerprint.into(),
        }
    }

    /// The registry's own file, parsed. **The numbers are the ones a worker
    /// recounted by hand at `88bff378` and this app has to agree with them**,
    /// because the whole defect was a rung chosen against a count nobody took.
    #[test]
    fn the_queue_parses_to_the_count_a_worker_recounted_by_hand() {
        let text = include_str!("fixtures/harvest-queue.md");
        let parsed = parse(text, "fp".into());
        assert_eq!(parsed.queued, 268, "268 queued rows at 88bff378");
        assert_eq!(parsed.sections.len(), 10, "ten sections");
        let smallest = parsed.sections.iter().min_by_key(|s| s.queued).unwrap();
        assert_eq!(
            (smallest.name.as_str(), smallest.queued),
            ("llm-observability (19)", 5),
            "the smallest is llm-observability with 5 queued"
        );
        assert!(
            parsed.sections.iter().all(|s| s.queued > 0),
            "every one of the ten sections still has some"
        );
        // The header row, the `| --- |` rule and the map-of-content table in
        // the preamble are not rows.
        assert_eq!(
            parsed.sections.iter().map(|s| s.rows).sum::<u32>(),
            294,
            "the frontmatter's own `entries:` count"
        );
    }

    /// **The bug, as a test.** At the registry's real state the ladder must
    /// reach for the drain; the refill is what it reached for eight times.
    #[test]
    fn the_registry_as_measured_dispatches_the_drain_not_the_refill() {
        let text = include_str!("fixtures/harvest-queue.md");
        let real = parse(text, "88bff378".into());
        assert_eq!(real.thin(), None, "268 rows is not a thin queue");
        let chosen = standing_rung(&real, &Marks::default()).unwrap();
        assert_eq!(chosen.rung, Rung::Drain);
        assert!(chosen.because.contains("268"), "{}", chosen.because);
    }

    /// The 3 -> 4 gate itself: a lane no section can batch from.
    #[test]
    fn the_refill_is_reached_only_when_no_section_can_furnish_a_batch() {
        // Plenty of rows, one fat section: the drain's rung.
        let fat = lane("a", &[("se", 50, 60), ("lo", 3, 20)]);
        assert_eq!(fat.thin(), None);
        assert_eq!(
            standing_rung(&fat, &Marks::default()).unwrap().rung,
            Rung::Drain,
            "an exhausted sibling section never puts the refill ahead of the drain"
        );

        // Exactly a batch is still the drain's.
        let edge = lane("a", &[("se", MIN_BATCH, 60)]);
        assert_eq!(edge.thin(), None);
        assert_eq!(
            standing_rung(&edge, &Marks::default()).unwrap().rung,
            Rung::Drain
        );

        // One row short, spread so no domain can batch: the refill's. The two
        // counts differ on purpose - `max_by_key` returns the LAST maximum, so
        // a tie would name the other section and the assertion below would be
        // about nothing.
        let thin = lane("a", &[("se", 3, 60), ("lo", 2, 20)]);
        assert!(thin.thin().is_some(), "5 rows, no batch of 4 in one domain");
        let chosen = standing_rung(&thin, &Marks::default()).unwrap();
        assert_eq!(chosen.rung, Rung::Refill);
        assert!(chosen.because.contains("'se'"), "{}", chosen.because);

        // Empty is trivially the refill's, and says so plainly.
        let empty = lane("a", &[("se", 0, 60)]);
        let chosen = standing_rung(&empty, &Marks::default()).unwrap();
        assert_eq!(chosen.rung, Rung::Refill);
        assert!(
            chosen.because.contains("still `queued`"),
            "{}",
            chosen.because
        );
    }

    /// **The cost lesson.** A rung that moved nothing is not re-dispatched
    /// against the same bytes - and the OTHER rung still gets its turn, so one
    /// inert rung never wedges the lane.
    #[test]
    fn a_rung_is_not_redispatched_against_unchanged_inputs() {
        let fat = lane("aaaa", &[("se", 50, 60)]);

        // The drain ran at these bytes and moved none of them: promote.
        let after_drain = Marks {
            drain: Some("aaaa".into()),
            refill: None,
        };
        let chosen = standing_rung(&fat, &after_drain).unwrap();
        assert_eq!(chosen.rung, Rung::Refill);
        assert!(
            chosen.because.contains("byte-identical"),
            "{}",
            chosen.because
        );

        // And the refill then ran at the same bytes and moved none either:
        // nothing more to spend on this state.
        let both = Marks {
            drain: Some("aaaa".into()),
            refill: Some("aaaa".into()),
        };
        assert_eq!(
            standing_rung(&fat, &both),
            None,
            "eight no-op dispatches in a row is the charge this brake exists to stop"
        );

        // Anything at all touching the queue re-arms both rungs.
        let moved = lane("bbbb", &[("se", 50, 60)]);
        assert_eq!(
            standing_rung(&moved, &both).unwrap().rung,
            Rung::Drain,
            "a moved queue is a new question"
        );

        // A thin lane whose refill already ran at these bytes stays put; the
        // drain has no batch to form, so there is nothing else to try.
        let thin = lane("aaaa", &[("se", 2, 60)]);
        assert_eq!(
            standing_rung(
                &thin,
                &Marks {
                    drain: None,
                    refill: Some("aaaa".into())
                }
            ),
            None
        );
        // ... and it re-arms on any change, exactly like the drain.
        let thin_moved = lane("cccc", &[("se", 2, 60)]);
        assert_eq!(
            standing_rung(
                &thin_moved,
                &Marks {
                    drain: None,
                    refill: Some("aaaa".into())
                }
            )
            .unwrap()
            .rung,
            Rung::Refill
        );
    }

    /// A drain's mark never silences the refill and vice versa: the marks are
    /// per-rung, because "the drain found nothing" says nothing about whether
    /// the gap list has a source worth fetching.
    #[test]
    fn the_two_marks_are_independent() {
        let thin = lane("aaaa", &[("se", 1, 60)]);
        // The drain ran here and moved nothing; the lane is thin anyway, so the
        // refill is the rung either way and its own mark is what gates it.
        assert_eq!(
            standing_rung(
                &thin,
                &Marks {
                    drain: Some("aaaa".into()),
                    refill: None
                }
            )
            .unwrap()
            .rung,
            Rung::Refill
        );
        let fat = lane("aaaa", &[("se", 40, 60)]);
        // The refill ran here and moved nothing; the drain is untouched by it.
        assert_eq!(
            standing_rung(
                &fat,
                &Marks {
                    drain: None,
                    refill: Some("aaaa".into())
                }
            )
            .unwrap()
            .rung,
            Rung::Drain
        );
    }

    /// A missing file is an empty lane, not an error - and it is a DIFFERENT
    /// fingerprint from any real file, so the brake cannot confuse "there is no
    /// queue" with "the queue has not moved".
    #[test]
    fn a_missing_queue_file_reads_as_an_empty_lane() {
        let dir = std::env::temp_dir().join(format!("curator-standing-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let read = super::read(&dir).unwrap();
        assert_eq!(read.queued, 0);
        assert_eq!(read.fingerprint, "absent");
        assert!(read.thin().is_some());
        assert_eq!(
            standing_rung(&read, &Marks::default()).unwrap().rung,
            Rung::Refill,
            "a registry with no queue at all is exactly what the refill is for"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// The fingerprint has to move when a single status flips, which is the
    /// only kind of change either rung makes. A length or an mtime would not.
    #[test]
    fn the_fingerprint_moves_on_a_status_flip_and_only_on_content() {
        let before = "| SEA-001 | 1 | u | t | c | x | why | content | queued |";
        let after = "| SEA-001 | 1 | u | t | c | x | why | content | parked |";
        assert_ne!(
            fingerprint(before.as_bytes()),
            fingerprint(after.as_bytes())
        );
        assert_eq!(
            before.len(),
            after.len(),
            "same byte count - a length check would have missed this"
        );
        assert_eq!(
            fingerprint(before.as_bytes()),
            fingerprint(before.as_bytes()),
            "and it is stable for the same bytes"
        );
    }

    /// The header, the rule and the preamble's own table are not queue rows.
    #[test]
    fn only_real_rows_are_counted() {
        let text = "# The harvest queue\n\
                    | Note | Holds |\n\
                    | --- | --- |\n\
                    | queue.md | The queue itself. |\n\
                    \n\
                    ## software-engineering (2)\n\
                    \n\
                    | id | pri | source | type | class | target | why | yield | status |\n\
                    | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n\
                    | SEA-001 | 1 | u | t | c | x | why | content | queued |\n\
                    | SEA-002 | 1 | u | t | c | x | why | content | mined: 2c/0cur/1L/3cat |\n\
                    | SEA-003 | 1 | u | t | c | x | why | content | parked: nothing live |\n";
        let parsed = parse(text, "fp".into());
        assert_eq!(parsed.sections.len(), 1);
        assert_eq!(parsed.sections[0].rows, 3, "three rows, not the header");
        assert_eq!(parsed.queued, 1, "`mined:` and `parked:` are terminal");
        // The preamble's own two-column table sits above the first heading and
        // is counted nowhere.
        assert_eq!(
            parsed.sections.iter().map(|s| s.rows).sum::<u32>(),
            3,
            "the map-of-content table is not a queue row"
        );
    }
}
