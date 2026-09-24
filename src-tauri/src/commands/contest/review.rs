//! The owner's review: `review.json` (structured) and `REVIEW.md` (rendered
//! from it in the /contest skill's review-file shape, which `refine --feedback`
//! consumes through `feedbackSection`).

use std::collections::BTreeSet;

use super::arena::{self, ArenaPaths, ManifestFile};
use super::types::{ContestReview, ContestReviewBucket};
use crate::error::AppError;

fn bucket_str(b: ContestReviewBucket) -> &'static str {
    match b {
        ContestReviewBucket::Failure => "failure",
        ContestReviewBucket::Impractical => "impractical",
        ContestReviewBucket::Shortlist => "shortlist",
        ContestReviewBucket::Winner => "winner",
    }
}

/// A percentage rounded to one decimal, no locale formatting (`12.3`, `50`).
fn pct(v: f64) -> String {
    let r = (v * 10.0).round() / 10.0;
    if r == r.trunc() {
        format!("{}", r as i64)
    } else {
        format!("{r:.1}")
    }
}

/// Owner text inside `REVIEW.md`, with every line that would open a section
/// demoted to `### `. `refine` reads the file through the instrument's
/// `feedbackSection`, which cuts a section at the next line starting `## `
/// and takes the FIRST `## <key>` line as that key's section, so an owner's
/// `## Layout notes` would end the section early and `## B/2 …` would hijack
/// B/2. A `# ` line is demoted too, so no owner line reads as a heading above
/// the file's own.
fn demote_headings(text: &str) -> String {
    text.split('\n')
        .map(|line| {
            if let Some(rest) = line.strip_prefix("## ") {
                format!("### {rest}")
            } else if let Some(rest) = line.strip_prefix("# ") {
                format!("### {rest}")
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// `REVIEW.md` from the review: `## All` is the whole-field note; then one
/// `## <letter>/<n>` per variant with a bucket, a note or pins — `Bucket:` first
/// when set, the owner's note (verbatim but for demoted headings), then each pin as
/// `- pin at (x%, y%) @ <w>x<h>: <note>`.
pub fn render_review_markdown(review: &ContestReview) -> String {
    let mut out = String::from("## All\n\n");
    let field = demote_headings(review.field.trim_end());
    if !field.is_empty() {
        out.push_str(&field);
        out.push('\n');
    }
    for v in &review.variants {
        let note = v.note.trim_end();
        if v.bucket.is_none() && note.trim().is_empty() && v.pins.is_empty() {
            continue;
        }
        out.push_str(&format!("\n## {}\n\n", v.key.trim()));
        if let Some(b) = v.bucket {
            out.push_str(&format!("Bucket: {}\n", bucket_str(b)));
            if !note.trim().is_empty() || !v.pins.is_empty() {
                out.push('\n');
            }
        }
        if !note.trim().is_empty() {
            out.push_str(&demote_headings(note));
            out.push('\n');
            if !v.pins.is_empty() {
                out.push('\n');
            }
        }
        for p in &v.pins {
            out.push_str(&format!(
                "- pin at ({}%, {}%) @ {}x{}: {}\n",
                pct(p.x_pct),
                pct(p.y_pct),
                p.width,
                p.height,
                p.note.trim().replace(['\r', '\n'], " ")
            ));
        }
    }
    out
}

/// The variant keys that exist (`manifest.json`), for validation.
pub fn known_keys(manifest: &ManifestFile) -> BTreeSet<String> {
    manifest
        .entries
        .values()
        .flat_map(|e| {
            e.variants
                .iter()
                .map(move |v| format!("{}/{}", e.letter, v.n))
        })
        .collect()
}

/// Every review key must name a variant the manifest knows; keys are unique;
/// pin coordinates are finite percentages.
pub fn validate_review(review: &ContestReview, known: &BTreeSet<String>) -> Result<(), AppError> {
    let mut seen = BTreeSet::new();
    for v in &review.variants {
        let key = v.key.trim();
        if !known.contains(key) {
            return Err(AppError::Validation(format!(
                "review names `{key}`, which is not a collected variant"
            )));
        }
        if !seen.insert(key.to_string()) {
            return Err(AppError::Validation(format!("review names `{key}` twice")));
        }
        for p in &v.pins {
            let ok = |x: f64| x.is_finite() && (0.0..=100.0).contains(&x);
            if !ok(p.x_pct) || !ok(p.y_pct) {
                return Err(AppError::Validation(format!(
                    "a pin on `{key}` is outside 0..100%"
                )));
            }
        }
    }
    Ok(())
}

/// Validate against the manifest, write `review.json`, render `REVIEW.md`.
pub fn save_review(paths: &ArenaPaths, review: &ContestReview) -> Result<(), AppError> {
    let manifest: ManifestFile =
        arena::read_json_opt(&paths.manifest_json())?.ok_or_else(|| {
            AppError::Validation("nothing to review yet: the contest has not been collected".into())
        })?;
    validate_review(review, &known_keys(&manifest))?;
    arena::write_json(&paths.review_json(), review)?;
    arena::write_text(&paths.review_md(), &render_review_markdown(review))
}

pub fn read_review(paths: &ArenaPaths) -> Option<ContestReview> {
    match arena::read_json_opt::<ContestReview>(&paths.review_json()) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "contest: review.json unreadable");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::contest::types::{ContestPin, ContestVariantReview};

    fn review() -> ContestReview {
        ContestReview {
            field: "Too many panels.\nKeep the centre simple.".into(),
            variants: vec![
                ContestVariantReview {
                    key: "A/1".into(),
                    bucket: Some(ContestReviewBucket::Shortlist),
                    note: "The rail reads well.".into(),
                    pins: vec![
                        ContestPin {
                            x_pct: 12.345,
                            y_pct: 50.0,
                            width: 1280,
                            height: 800,
                            note: "this label\nclips".into(),
                        },
                        ContestPin {
                            x_pct: 99.96,
                            y_pct: 0.04,
                            width: 1920,
                            height: 1080,
                            note: "corner".into(),
                        },
                    ],
                },
                ContestVariantReview {
                    key: "B/2".into(),
                    bucket: None,
                    note: "   ".into(),
                    pins: vec![],
                },
                ContestVariantReview {
                    key: "C/3".into(),
                    bucket: Some(ContestReviewBucket::Failure),
                    note: String::new(),
                    pins: vec![],
                },
                ContestVariantReview {
                    key: "D/1".into(),
                    bucket: None,
                    note: "Only a note.".into(),
                    pins: vec![],
                },
            ],
        }
    }

    #[test]
    fn renders_the_skill_review_shape() {
        let md = render_review_markdown(&review());
        let want = "## All\n\nToo many panels.\nKeep the centre simple.\n\
\n## A/1\n\nBucket: shortlist\n\nThe rail reads well.\n\n\
- pin at (12.3%, 50%) @ 1280x800: this label clips\n\
- pin at (100%, 0%) @ 1920x1080: corner\n\
\n## C/3\n\nBucket: failure\n\
\n## D/1\n\nOnly a note.\n";
        assert_eq!(md, want);
        // B/2 has nothing to say and gets no section.
        assert!(!md.contains("## B/2"));
    }

    /// The port of the instrument's `feedbackSection` (`lib/judging.mjs`):
    /// the body from the first `## ` line whose first token is `name` to the
    /// next `## ` line.
    fn feedback_section(text: &str, name: &str) -> String {
        let lines: Vec<&str> = text.split('\n').collect();
        let Some(start) = lines
            .iter()
            .position(|l| l.starts_with("## ") && l[3..].split_whitespace().next() == Some(name))
        else {
            return String::new();
        };
        let rest = &lines[start + 1..];
        let end = rest
            .iter()
            .position(|l| l.starts_with("## "))
            .unwrap_or(rest.len());
        rest[..end].join("\n").trim().to_string()
    }

    #[test]
    fn owner_headings_cannot_cut_or_hijack_a_feedback_section() {
        let r = ContestReview {
            field: "Keep it calm.\n## Layout notes\nThe rail is too wide.".into(),
            variants: vec![
                ContestVariantReview {
                    key: "A/1".into(),
                    bucket: None,
                    note: "Nice.\n## B/2 is better\n# Big".into(),
                    pins: vec![],
                },
                ContestVariantReview {
                    key: "B/2".into(),
                    bucket: None,
                    note: "The real B/2 note.".into(),
                    pins: vec![],
                },
            ],
        };
        let md = render_review_markdown(&r);
        let all = feedback_section(&md, "All");
        assert!(
            all.contains("The rail is too wide."),
            "All was cut: {all:?}"
        );
        let a = feedback_section(&md, "A/1");
        assert!(a.contains("# Big") && a.contains("B/2 is better"), "{a:?}");
        assert_eq!(feedback_section(&md, "B/2"), "The real B/2 note.");
    }

    #[test]
    fn an_empty_review_is_just_the_all_heading() {
        let r = ContestReview {
            field: String::new(),
            variants: vec![],
        };
        assert_eq!(render_review_markdown(&r), "## All\n\n");
    }

    #[test]
    fn validation_rejects_unknown_duplicate_and_out_of_range() {
        let known: BTreeSet<String> = ["A/1", "B/2", "C/3", "D/1"]
            .into_iter()
            .map(String::from)
            .collect();
        assert!(validate_review(&review(), &known).is_ok());
        let mut r = review();
        r.variants[0].key = "Z/9".into();
        assert!(validate_review(&r, &known).is_err());
        let mut r = review();
        r.variants[1].key = "A/1".into();
        assert!(validate_review(&r, &known).is_err());
        let mut r = review();
        r.variants[0].pins[0].x_pct = f64::NAN;
        assert!(validate_review(&r, &known).is_err());
        let mut r = review();
        r.variants[0].pins[0].y_pct = 101.0;
        assert!(validate_review(&r, &known).is_err());
    }
}
