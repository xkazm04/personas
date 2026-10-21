//! Pure vault-search scoring shared by the app's Obsidian graph search and the
//! standalone `personas-mcp` sidecar (two crate roots that cannot share code
//! with each other, but both re-export this crate's `utils`). One copy means a
//! fix to one search surface (e.g. the snippet char-boundary panic) lands in
//! both.

use std::collections::HashMap;

/// Lowercase alphanumeric/underscore tokenizer.
pub fn tokenize(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        if ch.is_alphanumeric() || ch == '_' {
            current.extend(ch.to_lowercase());
        } else if !current.is_empty() {
            tokens.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

/// TF-IDF scores per `(title, body)` document against the query terms.
///
/// `tf` is per-document term frequency. `idf` is the smoothed Robertson form
/// `ln((N + 1) / (df + 1)) + 1` (the +1s avoid division-by-zero on rare terms
/// in small vaults). Title hits get a flat +5 boost so a query like
/// "stoicism" surfaces a `Stoicism MOC.md` note even when its body never
/// repeats the term.
pub fn tfidf_scores(docs: &[(&str, &str)], query_terms: &[String]) -> Vec<f32> {
    let doc_count = docs.len().max(1) as f32;
    let mut doc_freq: HashMap<String, u32> = HashMap::new();
    let tokenized: Vec<HashMap<String, u32>> = docs
        .iter()
        .map(|(_, body)| {
            let mut tf: HashMap<String, u32> = HashMap::new();
            for tok in tokenize(body) {
                *tf.entry(tok).or_insert(0) += 1;
            }
            for tok in tf.keys() {
                *doc_freq.entry(tok.clone()).or_insert(0) += 1;
            }
            tf
        })
        .collect();

    let idf: HashMap<&String, f32> = query_terms
        .iter()
        .map(|term| {
            let df = *doc_freq.get(term).unwrap_or(&0) as f32;
            let val = ((doc_count + 1.0) / (df + 1.0)).ln() + 1.0;
            (term, val)
        })
        .collect();

    tokenized
        .iter()
        .enumerate()
        .map(|(i, tf)| {
            let title_lc = docs[i].0.to_lowercase();
            let mut score = 0.0_f32;
            for term in query_terms {
                let f = *tf.get(term).unwrap_or(&0) as f32;
                score += f * idf.get(term).copied().unwrap_or(0.0);
                if title_lc.contains(term) {
                    score += 5.0;
                }
            }
            score
        })
        .collect()
}

/// A short context snippet around the first match, UTF-8-boundary-safe: both
/// byte offsets snap to char boundaries, since `pos - 60` and `pos + len + 100`
/// land mid-character in any non-ASCII note (Czech, emoji, CJK).
pub fn snippet_for(body: &str, query_lc: &str) -> String {
    let body_lc = body.to_lowercase();
    let Some(pos) = body_lc.find(query_lc) else {
        return body.chars().take(160).collect();
    };
    let start = super::text::floor_char_boundary(body, pos.saturating_sub(60));
    let end = super::text::ceil_char_boundary(body, (pos + query_lc.len() + 100).min(body.len()));
    let mut s = body[start..end].replace('\n', " ");
    if start > 0 {
        s.insert(0, '…');
    }
    if end < body.len() {
        s.push('…');
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenize_lowercases_and_splits_on_punctuation() {
        assert_eq!(tokenize("Hello, Wörld_1!"), vec!["hello", "wörld_1"]);
    }

    #[test]
    fn title_hit_outranks_a_body_only_note() {
        let docs = [("Stoicism MOC", "nothing here"), ("Other", "stoicism once")];
        let scores = tfidf_scores(&docs, &["stoicism".to_string()]);
        assert!(scores[0] > scores[1]);
    }

    #[test]
    fn snippet_never_slices_mid_character() {
        let body = format!("{}needle{}", "ě".repeat(80), "ž".repeat(120));
        let s = snippet_for(&body, "needle");
        assert!(s.contains("needle") && s.starts_with('…') && s.ends_with('…'));
    }
}
