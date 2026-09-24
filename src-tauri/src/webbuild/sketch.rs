//! The sketch lane: a fast, headless first reading of a new project's vision.
//!
//! A new Studio project used to be three waits in a row: the scaffold (up to
//! 10 min, no progress), the dev-server boot, then a seed turn of ~15 min whose
//! plan and first question only arrived on its last line. Nothing overlapped,
//! and the screen had nothing true to draw for most of it.
//!
//! The sketch runs the moment the user submits, in parallel with the scaffold,
//! on the MICRO tier (a stateless one-shot, no tools, no conversation, no
//! project directory needed). In a few seconds it returns the site's shape
//! (pages and their regions, each with a one-line purpose), draft goals, and
//! the two or three questions only the user can answer. The frontend draws the
//! sketch as the plan sheet while setup runs, asks the questions during the
//! wait, and hands sketch + answers to the seed turn, so the long first turn
//! starts informed instead of stopping to ask them.
//!
//! It is a sketch, not the plan: the seed turn still owns BUILD_PLAN and may
//! reshape everything. The prompt says so, and so does the UI.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::AppError;

/// Hard caps, so a verbose answer cannot flood the sheet.
pub const MAX_PAGES: usize = 4;
pub const MAX_REGIONS: usize = 6;
pub const MAX_GOALS: usize = 8;
pub const MAX_QUESTIONS: usize = 3;
pub const MAX_OPTIONS: usize = 4;

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SketchRegion {
    pub title: String,
    #[serde(default)]
    pub purpose: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SketchPage {
    pub title: String,
    #[serde(default)]
    pub route: String,
    #[serde(default)]
    pub regions: Vec<SketchRegion>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SketchGoal {
    pub title: String,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SketchQuestion {
    pub question: String,
    #[serde(default)]
    pub options: Vec<String>,
    /// One line: why only the user can answer it.
    #[serde(default)]
    pub why: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Default)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SiteSketch {
    /// One or two sentences: what she understood the site to be.
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub pages: Vec<SketchPage>,
    #[serde(default)]
    pub goals: Vec<SketchGoal>,
    #[serde(default)]
    pub questions: Vec<SketchQuestion>,
}

/// The one prompt the sketch call sends. Stateless: the vision is the only input.
pub fn sketch_prompt(vision: &str) -> String {
    format!(
        r#"You are Athena, sketching a web app before it is built. Read the vision below and answer with ONLY one JSON object, no prose, no code fence.

Shape:
{{"summary":"1-2 plain sentences: what this site is and for whom",
 "pages":[{{"title":"Home","route":"/","regions":[{{"title":"Top bar","purpose":"brand and the way to order"}}]}}],
 "goals":[{{"title":"Daily menu","note":"what is baked today, with prices"}}],
 "questions":[{{"question":"What should the site be called?","options":["..."],"why":"only you know the brand"}}]}}

Rules:
- 1 to {MAX_PAGES} pages; the first is the home page. 3 to {MAX_REGIONS} regions per page, top to bottom, titles of 1-4 words a non-technical owner understands, purposes of at most 10 words.
- 4 to {MAX_GOALS} goals in build order: a short title (max 24 chars) and a note (max 40 chars). No technical words (no framework, component, API).
- 1 to {MAX_QUESTIONS} questions ONLY about things the owner alone knows: the name if the vision does not give one, the core features or scope if unclear, the audience or real content. Never ask about colours, layout or technology; you decide those later. 2 to {MAX_OPTIONS} short options each when sensible, else an empty list.
- This is a first sketch that the full planning step may change. Be concrete to this vision; no generic filler.

Vision:
{vision}"#,
        vision = vision.trim()
    )
}

fn clip(s: &str, max_chars: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= max_chars {
        t.to_string()
    } else {
        t.chars()
            .take(max_chars)
            .collect::<String>()
            .trim_end()
            .to_string()
    }
}

/// A bounded head of a reply, for an error that has to say what came back.
fn head(text: &str) -> String {
    clip(&text.replace('\n', " "), 160)
}

/// Parse the model's answer: the first `{` to the last `}` as JSON (a stray
/// sentence or a code fence around it is tolerated), then clean and cap every
/// list. The error says why and carries the head of the reply, so a failed
/// (paid) sketch can be logged and diagnosed instead of vanishing.
pub fn parse_sketch(text: &str) -> Result<SiteSketch, AppError> {
    let fail = |why: String| AppError::Internal(format!("studio sketch: {why}"));
    let (Some(start), Some(end)) = (text.find('{'), text.rfind('}')) else {
        return Err(fail(format!("no JSON object in the reply: {}", head(text))));
    };
    if end <= start {
        return Err(fail(format!("no JSON object in the reply: {}", head(text))));
    }
    let raw: SiteSketch = serde_json::from_str(&text[start..=end])
        .map_err(|e| fail(format!("reply is not a sketch ({e}): {}", head(text))))?;
    let pages: Vec<SketchPage> = raw
        .pages
        .into_iter()
        .filter(|p| !p.title.trim().is_empty())
        .take(MAX_PAGES)
        .map(|p| SketchPage {
            title: clip(&p.title, 40),
            route: clip(&p.route, 60),
            regions: p
                .regions
                .into_iter()
                .filter(|r| !r.title.trim().is_empty())
                .take(MAX_REGIONS)
                .map(|r| SketchRegion {
                    title: clip(&r.title, 40),
                    purpose: clip(&r.purpose, 90),
                })
                .collect(),
        })
        .collect();
    if pages.is_empty() {
        return Err(fail(format!("the sketch has no pages: {}", head(text))));
    }
    Ok(SiteSketch {
        summary: clip(&raw.summary, 300),
        pages,
        goals: raw
            .goals
            .into_iter()
            .filter(|g| !g.title.trim().is_empty())
            .take(MAX_GOALS)
            .map(|g| SketchGoal {
                title: clip(&g.title, 40),
                note: clip(&g.note, 60),
            })
            .collect(),
        questions: raw
            .questions
            .into_iter()
            .filter(|q| !q.question.trim().is_empty())
            .take(MAX_QUESTIONS)
            .map(|q| SketchQuestion {
                question: clip(&q.question, 200),
                options: q
                    .options
                    .into_iter()
                    .map(|o| clip(&o, 60))
                    .filter(|o| !o.is_empty())
                    .take(MAX_OPTIONS)
                    .collect(),
                why: clip(&q.why, 120),
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = r#"Here you go:
```json
{"summary":"A neighbourhood bakery site.","pages":[{"title":"Home","route":"/","regions":[{"title":"Top bar","purpose":"brand"},{"title":"Today's bake","purpose":"what is fresh"}]},{"title":"Order","route":"/order","regions":[{"title":"Basket","purpose":"pick bakes"}]}],"goals":[{"title":"Daily menu","note":"prices"}],"questions":[{"question":"Pickup only?","options":["Yes","Delivery too"],"why":"business model"}]}
```"#;

    #[test]
    fn parses_through_prose_and_fences() {
        let s = parse_sketch(GOOD).expect("sketch");
        assert_eq!(s.pages.len(), 2);
        assert_eq!(s.pages[0].regions[1].title, "Today's bake");
        assert_eq!(s.questions[0].options, vec!["Yes", "Delivery too"]);
    }

    #[test]
    fn caps_every_list() {
        let pages: Vec<String> = (0..9)
            .map(|i| {
                let regions: Vec<String> =
                    (0..12).map(|j| format!(r#"{{"title":"R{j}"}}"#)).collect();
                format!(r#"{{"title":"P{i}","regions":[{}]}}"#, regions.join(","))
            })
            .collect();
        let qs: Vec<String> = (0..7)
            .map(|i| format!(r#"{{"question":"Q{i}","options":["a","b","c","d","e","f"]}}"#))
            .collect();
        let text = format!(
            r#"{{"pages":[{}],"questions":[{}]}}"#,
            pages.join(","),
            qs.join(",")
        );
        let s = parse_sketch(&text).expect("sketch");
        assert_eq!(s.pages.len(), MAX_PAGES);
        assert!(s.pages.iter().all(|p| p.regions.len() == MAX_REGIONS));
        assert_eq!(s.questions.len(), MAX_QUESTIONS);
        assert!(s.questions.iter().all(|q| q.options.len() == MAX_OPTIONS));
    }

    #[test]
    fn refuses_nothing_to_draw() {
        let msg = |t: &str| parse_sketch(t).unwrap_err().to_string();
        let e = msg("no json here");
        assert!(
            e.contains("no json here"),
            "the reason carries the reply head: {e}"
        );
        assert!(msg(r#"{"summary":"x","pages":[]}"#).contains("no pages"));
        assert!(parse_sketch(r#"{"pages":[{"title":"  "}]}"#).is_err());
        assert!(msg(r#"{"pages": 3}"#).contains("not a sketch"));
    }

    #[test]
    fn the_prompt_carries_the_vision_and_the_caps() {
        let p = sketch_prompt("  A bakery that takes orders  ");
        assert!(p.ends_with("A bakery that takes orders"));
        assert!(p.contains(&format!("1 to {MAX_PAGES} pages")));
    }
}
