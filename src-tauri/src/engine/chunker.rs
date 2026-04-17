//! Document chunking for vector knowledge bases.
//!
//! Splits text into overlapping chunks suitable for embedding.
//! Uses a simple sentence-aware splitter to avoid mid-word breaks.

#[cfg(feature = "ml")]
use sha2::{Digest, Sha256};

/// Result of chunking a document.
#[cfg(feature = "ml")]
pub struct ChunkResult {
    pub chunks: Vec<TextChunk>,
    pub content_hash: String,
    pub byte_size: usize,
}

/// A single text chunk with positional metadata.
#[cfg(feature = "ml")]
pub struct TextChunk {
    pub content: String,
    pub char_count: usize,
    pub chunk_index: u32,
}

/// Chunk a raw text string into overlapping segments.
///
/// Uses a sentence-aware algorithm:
/// 1. Split text into sentences (by `.` `!` `?` followed by whitespace)
/// 2. Accumulate sentences until `max_chars` is reached
/// 3. Overlap by re-including the last `overlap_chars` characters from the
///    previous chunk in the next chunk
///
/// `max_chars` and `overlap_chars` are character counts (not tokens) for
/// simplicity in the MVP. A typical English token is ~4 characters, so
/// 512 tokens ≈ 2048 chars.
#[cfg(feature = "ml")]
pub fn chunk_text(text: &str, max_chars: usize, overlap_chars: usize) -> ChunkResult {
    let byte_size = text.len();
    let content_hash = {
        let mut hasher = Sha256::new();
        hasher.update(text.as_bytes());
        hex::encode(hasher.finalize())
    };

    let trimmed = text.trim();
    if trimmed.is_empty() {
        return ChunkResult {
            chunks: Vec::new(),
            content_hash,
            byte_size,
        };
    }

    // If text fits in a single chunk, return it directly
    if trimmed.chars().count() <= max_chars {
        return ChunkResult {
            chunks: vec![TextChunk {
                char_count: trimmed.chars().count(),
                content: trimmed.to_string(),
                chunk_index: 0,
            }],
            content_hash,
            byte_size,
        };
    }

    let mut chunks = Vec::new();
    let mut start = 0;
    let chars: Vec<char> = trimmed.chars().collect();
    let total = chars.len();

    while start < total {
        let end = (start + max_chars).min(total);

        // Try to break at a sentence boundary (. ! ? followed by space)
        let actual_end = if end < total {
            find_sentence_break(&chars, start, end).unwrap_or(end)
        } else {
            end
        };

        let chunk_str: String = chars[start..actual_end].iter().collect();
        let chunk_str = chunk_str.trim().to_string();

        if !chunk_str.is_empty() {
            chunks.push(TextChunk {
                char_count: chunk_str.chars().count(),
                content: chunk_str,
                chunk_index: chunks.len() as u32,
            });
        }

        // Move start forward, accounting for overlap
        let prev_start = start;
        if actual_end <= start {
            // Safety: avoid infinite loop if no progress made
            start = actual_end + 1;
        } else {
            start = actual_end.saturating_sub(overlap_chars);
            // Ensure we always make forward progress
            if start <= prev_start {
                start = actual_end;
            }
        }
    }

    ChunkResult {
        chunks,
        content_hash,
        byte_size,
    }
}

/// Find the best sentence break point searching backward from `end`.
#[cfg(feature = "ml")]
fn find_sentence_break(chars: &[char], start: usize, end: usize) -> Option<usize> {
    // Search backward from end for sentence-ending punctuation followed by whitespace
    let search_start = if end > start + 100 { end - 100 } else { start };

    for i in (search_start..end).rev() {
        if i + 1 < chars.len()
            && matches!(chars[i], '.' | '!' | '?' | '\n')
            && (i + 1 >= chars.len() || chars[i + 1].is_whitespace())
        {
            return Some(i + 1);
        }
    }
    None
}

/// Read a file from disk and chunk its content.
/// Supports: .txt, .md, .html, .htm
#[cfg(feature = "ml")]
pub fn chunk_file(
    path: &std::path::Path,
    max_chars: usize,
    overlap_chars: usize,
) -> Result<ChunkResult, crate::error::AppError> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let raw = std::fs::read_to_string(path)?;

    let text = match ext.as_str() {
        "md" | "txt" | "csv" | "json" | "yaml" | "yml" | "toml" | "log" | "rs" | "py" | "js"
        | "ts" | "tsx" | "jsx" => raw,
        "html" | "htm" => strip_html_tags(&raw),
        other => {
            return Err(crate::error::AppError::Validation(format!(
                "Unsupported file format for knowledge base ingestion: .{other}"
            )));
        }
    };

    Ok(chunk_text(&text, max_chars, overlap_chars))
}

/// Very basic HTML tag stripper. Removes tags and decodes common entities.
#[cfg(feature = "ml")]
fn strip_html_tags(html: &str) -> String {
    let mut result = String::with_capacity(html.len());
    let mut in_tag = false;

    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }

    result
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

#[cfg(all(test, feature = "ml"))]
mod tests {
    use super::*;

    #[test]
    fn test_chunk_short_text() {
        let result = chunk_text("Hello world.", 2048, 200);
        assert_eq!(result.chunks.len(), 1);
        assert_eq!(result.chunks[0].content, "Hello world.");
    }

    #[test]
    fn test_chunk_long_text() {
        let text = "First sentence. ".repeat(200);
        let result = chunk_text(&text, 500, 50);
        assert!(result.chunks.len() > 1);
        assert!(!result.content_hash.is_empty());
    }

    #[test]
    fn test_chunk_empty() {
        let result = chunk_text("", 500, 50);
        assert!(result.chunks.is_empty());
    }

    #[test]
    fn test_strip_html() {
        let html = "<p>Hello <b>world</b> &amp; friends</p>";
        assert_eq!(strip_html_tags(html), "Hello world & friends");
    }
}
