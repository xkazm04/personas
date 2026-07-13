//! Document chunking for vector knowledge bases.
//!
//! Splits text into overlapping chunks suitable for embedding.
//! Uses a simple sentence-aware splitter to avoid mid-word breaks.

#[cfg(feature = "ml")]
use sha2::{Digest, Sha256};

#[cfg(feature = "ml")]
use crate::error::AppError;

/// Result of chunking a document.
#[cfg(feature = "ml")]
pub struct ChunkResult {
    pub chunks: Vec<TextChunk>,
    pub content_hash: String,
    pub byte_size: usize,
    /// Page count for paginated sources (PDF); `None` for flat text.
    pub page_count: Option<u32>,
    /// Pages that carried no usable text layer at all — i.e. almost certainly
    /// scanned images. They contribute zero chunks, so without this counter a
    /// scanned PDF ingests "successfully" as an empty document and the user is
    /// never told why searches come back blank.
    pub empty_pages: u32,
}

/// A single text chunk with positional metadata.
#[cfg(feature = "ml")]
pub struct TextChunk {
    pub content: String,
    pub char_count: usize,
    pub chunk_index: u32,
    /// 1-based source page for paginated sources; `None` for flat text.
    /// This is what lets a citation say *where* a claim came from.
    pub page: Option<u32>,
    /// How much to trust that this text is a faithful reading of the source,
    /// in 0.0..=1.0. Verbatim text (a .md/.txt file, or a PDF page with a
    /// healthy text layer) is 1.0. A PDF page with only a scrap of text is
    /// most likely a scanned image with a caption — the text we got is real
    /// but it is *not* the page, so downstream answers built on it are
    /// unreliable and should say so rather than sound confident.
    pub extraction_confidence: f32,
}

/// Below this many characters, a PDF page's text layer is too thin to be a
/// faithful reading of the page — almost always a scanned/raster page whose
/// only extractable text is a header or a caption.
#[cfg(feature = "ml")]
const SPARSE_PAGE_CHARS: usize = 200;

/// Confidence assigned to text recovered from such a page.
#[cfg(feature = "ml")]
const SPARSE_PAGE_CONFIDENCE: f32 = 0.4;

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

    // Flat text is verbatim by definition — full confidence, no page.
    let chunks = segment(text, max_chars, overlap_chars, None, 1.0, 0);

    ChunkResult {
        chunks,
        content_hash,
        byte_size,
        page_count: None,
        empty_pages: 0,
    }
}

/// Split one span of text into overlapping chunks, tagging each with the given
/// page + confidence and numbering from `first_index`. Returns the chunks in
/// order; an empty/whitespace span yields none.
///
/// Shared by `chunk_text` (one span, no page) and `chunk_pdf` (one span per
/// page) so the sentence-boundary and overlap behaviour cannot drift between
/// the two.
#[cfg(feature = "ml")]
fn segment(
    text: &str,
    max_chars: usize,
    overlap_chars: usize,
    page: Option<u32>,
    extraction_confidence: f32,
    first_index: u32,
) -> Vec<TextChunk> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let mk = |content: String, index: u32| TextChunk {
        char_count: content.chars().count(),
        content,
        chunk_index: index,
        page,
        extraction_confidence,
    };

    // If text fits in a single chunk, return it directly
    if trimmed.chars().count() <= max_chars {
        return vec![mk(trimmed.to_string(), first_index)];
    }

    let mut chunks: Vec<TextChunk> = Vec::new();
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
            let index = first_index + chunks.len() as u32;
            chunks.push(mk(chunk_str, index));
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

    chunks
}

/// Chunk a PDF by extracting its **text layer**, one page at a time.
///
/// Page-at-a-time is the whole point: it is what lets every resulting chunk
/// carry the page it came from, so an answer can cite "p. 7" instead of
/// gesturing at a 200-page document. Extracting the document as one blob
/// (`extract_text`) would be simpler and would throw that away.
///
/// This reads the text layer only — it does **not** OCR. A scanned PDF is a
/// pile of images with no text layer, so pages come back empty or with a
/// scrap of caption text. Rather than pretend that succeeded, we score such
/// pages down (`SPARSE_PAGE_CONFIDENCE`) and count the fully-empty ones, so
/// the caller can tell the user their document is scanned instead of leaving
/// them wondering why search returns nothing.
#[cfg(feature = "ml")]
pub fn chunk_pdf(
    path: &std::path::Path,
    max_chars: usize,
    overlap_chars: usize,
) -> Result<ChunkResult, crate::error::AppError> {
    let bytes = std::fs::read(path)?;

    let byte_size = bytes.len();
    let content_hash = {
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        hex::encode(hasher.finalize())
    };

    // pdf-extract panics on some malformed/exotic PDFs rather than returning
    // Err. A panic here would take down the ingest worker (and, in a release
    // build, the process) over a single bad file, so contain it and report it
    // as a normal per-file failure — ingest_files already tolerates those.
    let pages = std::panic::catch_unwind(|| pdf_extract::extract_text_from_mem_by_pages(&bytes))
        .map_err(|_| {
            AppError::Validation(format!(
                "Could not read PDF (the file may be malformed or password-protected): {}",
                path.display()
            ))
        })?
        .map_err(|e| {
            AppError::Validation(format!(
                "Could not read PDF (the file may be malformed or password-protected): {e}"
            ))
        })?;

    let page_count = pages.len() as u32;
    let mut chunks: Vec<TextChunk> = Vec::new();
    let mut empty_pages = 0u32;

    for (i, page_text) in pages.iter().enumerate() {
        let page_no = (i + 1) as u32;
        let trimmed = page_text.trim();

        if trimmed.is_empty() {
            empty_pages += 1;
            continue;
        }

        let confidence = if trimmed.chars().count() < SPARSE_PAGE_CHARS {
            SPARSE_PAGE_CONFIDENCE
        } else {
            1.0
        };

        let next_index = chunks.len() as u32;
        chunks.extend(segment(
            trimmed,
            max_chars,
            overlap_chars,
            Some(page_no),
            confidence,
            next_index,
        ));
    }

    Ok(ChunkResult {
        chunks,
        content_hash,
        byte_size,
        page_count: Some(page_count),
        empty_pages,
    })
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
///
/// Text-ish formats are read verbatim; `.pdf` goes through `chunk_pdf`, which
/// preserves page numbers (see its doc comment). PDFs are read as bytes, not
/// as a UTF-8 string, so they must be routed *before* the `read_to_string`
/// below — that call would fail on any real PDF's binary content.
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

    if ext == "pdf" {
        return chunk_pdf(path, max_chars, overlap_chars);
    }

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

    #[test]
    fn flat_text_chunks_have_no_page_and_full_confidence() {
        let result = chunk_text("Hello world.", 2048, 200);
        assert_eq!(result.page_count, None);
        assert_eq!(result.empty_pages, 0);
        assert_eq!(result.chunks[0].page, None);
        assert_eq!(result.chunks[0].extraction_confidence, 1.0);
    }

    #[test]
    fn segment_tags_page_and_confidence_and_numbers_from_offset() {
        // A long span so it splits into multiple chunks, all sharing the page
        // and confidence, numbered from the given offset.
        let text = "First sentence. ".repeat(200);
        let chunks = segment(&text, 500, 50, Some(7), 0.4, 10);
        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|c| c.page == Some(7)));
        assert!(chunks.iter().all(|c| c.extraction_confidence == 0.4));
        assert_eq!(chunks[0].chunk_index, 10);
        assert_eq!(chunks[1].chunk_index, 11);
    }

    #[test]
    fn segment_empty_span_yields_nothing() {
        assert!(segment("   \n  ", 500, 50, Some(1), 1.0, 0).is_empty());
    }

    #[test]
    fn sparse_page_threshold_is_below_dense_page() {
        // Guards the invariant the PDF path relies on: a caption-sized scrap is
        // sparse (low confidence), a paragraph is not.
        let scrap = "Figure 4.";
        let paragraph = "word ".repeat(60); // 300 chars > SPARSE_PAGE_CHARS
        assert!(scrap.chars().count() < SPARSE_PAGE_CHARS);
        assert!(paragraph.chars().count() >= SPARSE_PAGE_CHARS);
    }
}
