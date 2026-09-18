//! Anchor sampler: the random half of the randomizer.
//!
//! An LLM asked for "three different styles" collapses to the same friendly
//! mode every time, so the spread is decided here, in plain Rust with a
//! seedable RNG, and the model is only allowed to nudge each anchor by one step.

use rand::Rng;

use crate::db::models::{TwinStyleDims, TwinStylePins};

/// Dimension names in wire order. Every per-dimension loop in this module
/// family walks this array, so the order is fixed in exactly one place.
pub(crate) const DIM_NAMES: [&str; 8] = [
    "formality",
    "warmth",
    "humor",
    "energy",
    "length",
    "directness",
    "expressiveness",
    "detail",
];

/// The scale text each prompt shows the model, one line per dimension.
pub(crate) const DIM_SCALES: [&str; 8] = [
    "formality 1 intimate / 2 casual / 3 consultative / 4 formal / 5 ceremonial",
    "warmth 1 detached / 2 neutral / 3 cordial / 4 warm / 5 affectionate",
    "humor 1 none / 2 dry / 3 light / 4 playful / 5 irreverent",
    "energy 1 matter-of-fact / 2 calm / 3 engaged / 4 upbeat / 5 exuberant",
    "length 1 one-liner / 2 brief / 3 medium / 4 full / 5 expansive",
    "directness 1 blunt / 2 direct / 3 balanced / 4 softened / 5 indirect",
    "expressiveness 1 none / 2 rare / 3 occasional / 4 frequent / 5 heavy (emoji, exclamations, slang)",
    "detail 1 headline / 2 key points / 3 explained / 4 thorough / 5 exhaustive and structured",
];

/// Minimum pairwise L1 distance between the three anchors of one roll.
pub(crate) const MIN_SPREAD: u32 = 4;
/// Minimum L1 distance from the current style and every `avoid` vector.
pub(crate) const MIN_NOVELTY: u32 = 3;

/// Draw weights for the values 1..=5: the middle of every scale is where most
/// people actually write, and the coherence rule caps the extremes anyway.
const VALUE_WEIGHTS: [u32; 5] = [1, 3, 4, 3, 1];
/// Rejection tries per anchor vector.
const MAX_TRIES: usize = 64;
/// Whole-set attempts per relaxation level. A greedy first anchor can box the
/// other two in, so a failed set is redrawn before the bar is lowered.
const SET_ATTEMPTS: usize = 4;
/// (spread, novelty) per level, strictest first. The last level asks only for
/// coherence, which a coherent pin set can always satisfy.
const RELAX_STEPS: [(u32, u32); 5] = [(MIN_SPREAD, MIN_NOVELTY), (3, 2), (2, 1), (1, 0), (0, 0)];

pub(crate) fn dims_array(d: &TwinStyleDims) -> [u8; 8] {
    [
        d.formality,
        d.warmth,
        d.humor,
        d.energy,
        d.length,
        d.directness,
        d.expressiveness,
        d.detail,
    ]
}

pub(crate) fn dims_from(a: [u8; 8]) -> TwinStyleDims {
    TwinStyleDims {
        formality: a[0],
        warmth: a[1],
        humor: a[2],
        energy: a[3],
        length: a[4],
        directness: a[5],
        expressiveness: a[6],
        detail: a[7],
    }
}

pub(crate) fn pins_array(p: &TwinStylePins) -> [Option<u8>; 8] {
    [
        p.formality,
        p.warmth,
        p.humor,
        p.energy,
        p.length,
        p.directness,
        p.expressiveness,
        p.detail,
    ]
}

/// Range and PAIR rules: what every style must satisfy wherever it appears
/// (presets, channel targets, applied tones, rolled candidates). Empty means
/// valid.
pub(crate) fn style_pair_errors(d: &TwinStyleDims) -> Vec<String> {
    let mut errors: Vec<String> = DIM_NAMES
        .iter()
        .zip(dims_array(d))
        .filter(|(_, v)| !(1..=5).contains(v))
        .map(|(name, v)| format!("{name}: {v} outside 1-5"))
        .collect();
    if d.formality >= 4 && d.expressiveness >= 4 {
        errors.push(format!(
            "formality {} with expressiveness {} (never both 4 or higher)",
            d.formality, d.expressiveness
        ));
    }
    if d.humor == 5 && d.formality == 5 {
        errors.push("humor 5 with formality 5".to_string());
    }
    errors
}

/// The EXTREMES rule (at most 3 dimensions at 1 or 5). It shapes what the
/// randomizer proposes and nothing else: two curated presets (executive brief,
/// close and informal) sit deliberately past it, and the deterministic channel
/// shift can add one more extreme, so materialize and apply never check it.
pub(crate) fn style_extremes_errors(d: &TwinStyleDims) -> Vec<String> {
    let extremes = dims_array(d)
        .iter()
        .filter(|v| **v == 1 || **v == 5)
        .count();
    if extremes > 3 {
        vec![format!(
            "{extremes} dimensions at 1 or 5 (at most 3 allowed)"
        )]
    } else {
        Vec::new()
    }
}

/// Full coherence for the ROLL path (anchors, pins, rolled candidates): the
/// pair rules plus the extremes rule. Empty means coherent.
pub(crate) fn style_coherence_errors(d: &TwinStyleDims) -> Vec<String> {
    let mut errors = style_pair_errors(d);
    errors.extend(style_extremes_errors(d));
    errors
}

pub(crate) fn l1(a: &TwinStyleDims, b: &TwinStyleDims) -> u32 {
    dims_array(a)
        .iter()
        .zip(dims_array(b))
        .map(|(x, y)| u32::from(x.abs_diff(y)))
        .sum()
}

/// Pinned values held, every other dimension at the neutral middle. Coherent
/// whenever the pins are, which makes it both the pin validator's probe and
/// the sampler's last-resort fallback.
pub(crate) fn moderate_completion(pins: &TwinStylePins) -> TwinStyleDims {
    dims_from(pins_array(pins).map(|p| p.unwrap_or(3)))
}

/// Why a pin set can never yield a coherent style (empty when it can). If the
/// neutral completion is incoherent, only the pins themselves can be to blame.
pub(crate) fn pin_errors(pins: &TwinStylePins) -> Vec<String> {
    style_coherence_errors(&moderate_completion(pins))
        .into_iter()
        .map(|e| format!("pins.{e}"))
        .collect()
}

pub(crate) struct AnchorDraw {
    pub anchors: [TwinStyleDims; 3],
    /// True when the spread or novelty bar had to be lowered to fit the pins.
    pub relaxed: bool,
}

fn draw_value<R: Rng + ?Sized>(rng: &mut R) -> u8 {
    let total: u32 = VALUE_WEIGHTS.iter().sum();
    let mut roll = rng.gen_range(0..total);
    for (i, w) in VALUE_WEIGHTS.iter().enumerate() {
        if roll < *w {
            // i < 5, so the cast cannot truncate.
            return i as u8 + 1;
        }
        roll -= w;
    }
    3
}

fn draw_vector<R: Rng + ?Sized>(rng: &mut R, pins: &[Option<u8>; 8]) -> TwinStyleDims {
    let mut a = [0u8; 8];
    for (slot, pin) in a.iter_mut().zip(pins) {
        *slot = pin.unwrap_or_else(|| draw_value(rng));
    }
    dims_from(a)
}

fn try_draw_set<R: Rng + ?Sized>(
    rng: &mut R,
    pins: &[Option<u8>; 8],
    references: &[&TwinStyleDims],
    spread: u32,
    novelty: u32,
) -> Option<[TwinStyleDims; 3]> {
    let mut chosen: Vec<TwinStyleDims> = Vec::with_capacity(3);
    while chosen.len() < 3 {
        let mut found = None;
        for _ in 0..MAX_TRIES {
            let c = draw_vector(rng, pins);
            if style_coherence_errors(&c).is_empty()
                && chosen.iter().all(|o| l1(&c, o) >= spread)
                && references.iter().all(|r| l1(&c, r) >= novelty)
            {
                found = Some(c);
                break;
            }
        }
        chosen.push(found?);
    }
    Some([chosen[0], chosen[1], chosen[2]])
}

/// Draw 3 anchors: pins held exactly, each coherent, pairwise at least
/// [`MIN_SPREAD`] apart and at least [`MIN_NOVELTY`] from `current` and every
/// `avoid` vector. When the pins make that impossible the bar is lowered step
/// by step and `relaxed` is set; this never errors. The caller validates the
/// pins with [`pin_errors`] first; incoherent pins still return (the neutral
/// fallback) rather than panic.
pub(crate) fn sample_anchors<R: Rng + ?Sized>(
    rng: &mut R,
    pins: &TwinStylePins,
    current: Option<&TwinStyleDims>,
    avoid: &[TwinStyleDims],
) -> AnchorDraw {
    let pin_slots = pins_array(pins);
    let references: Vec<&TwinStyleDims> = current.into_iter().chain(avoid.iter()).collect();
    for (level, (spread, novelty)) in RELAX_STEPS.iter().enumerate() {
        for _ in 0..SET_ATTEMPTS {
            if let Some(anchors) = try_draw_set(rng, &pin_slots, &references, *spread, *novelty) {
                return AnchorDraw {
                    anchors,
                    relaxed: level > 0,
                };
            }
        }
    }
    let neutral = moderate_completion(pins);
    AnchorDraw {
        anchors: [neutral, neutral, neutral],
        relaxed: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    fn random_coherent_pins(rng: &mut StdRng) -> TwinStylePins {
        loop {
            let mut slots = [None; 8];
            for slot in slots.iter_mut() {
                if rng.gen_bool(0.3) {
                    *slot = Some(rng.gen_range(1..=5));
                }
            }
            let pins = TwinStylePins {
                formality: slots[0],
                warmth: slots[1],
                humor: slots[2],
                energy: slots[3],
                length: slots[4],
                directness: slots[5],
                expressiveness: slots[6],
                detail: slots[7],
            };
            if pin_errors(&pins).is_empty() {
                return pins;
            }
        }
    }

    fn random_dims(rng: &mut StdRng) -> TwinStyleDims {
        let mut a = [0u8; 8];
        for v in a.iter_mut() {
            *v = rng.gen_range(1..=5);
        }
        dims_from(a)
    }

    #[test]
    fn property_over_1000_seeds() {
        let mut relaxed_unpinned = 0;
        for seed in 0..1000u64 {
            let mut setup = StdRng::seed_from_u64(seed ^ 0x5eed);
            let pins = if seed % 2 == 0 {
                TwinStylePins::default()
            } else {
                random_coherent_pins(&mut setup)
            };
            let current = (seed % 3 == 0).then(|| random_dims(&mut setup));
            let avoid: Vec<TwinStyleDims> =
                (0..(seed % 4)).map(|_| random_dims(&mut setup)).collect();

            let mut rng = StdRng::seed_from_u64(seed);
            let draw = sample_anchors(&mut rng, &pins, current.as_ref(), &avoid);
            let pin_slots = pins_array(&pins);

            for (i, a) in draw.anchors.iter().enumerate() {
                assert!(
                    style_coherence_errors(a).is_empty(),
                    "seed {seed} anchor {i} incoherent: {a:?}"
                );
                for (d, pin) in pin_slots.iter().enumerate() {
                    if let Some(p) = pin {
                        assert_eq!(dims_array(a)[d], *p, "seed {seed}: pin {d} moved");
                    }
                }
            }
            if !draw.relaxed {
                for i in 0..3 {
                    for j in (i + 1)..3 {
                        assert!(
                            l1(&draw.anchors[i], &draw.anchors[j]) >= MIN_SPREAD,
                            "seed {seed}: anchors {i},{j} too close"
                        );
                    }
                    for r in current.iter().chain(avoid.iter()) {
                        assert!(
                            l1(&draw.anchors[i], r) >= MIN_NOVELTY,
                            "seed {seed}: anchor {i} too close to a reference"
                        );
                    }
                }
            } else if pins_array(&pins).iter().all(Option::is_none) {
                relaxed_unpinned += 1;
            }
        }
        // With nothing pinned the space is wide open: relaxing there would mean
        // the sampler, not the constraints, is failing.
        assert_eq!(relaxed_unpinned, 0, "unpinned rolls must never relax");
    }

    #[test]
    fn the_same_seed_draws_the_same_anchors() {
        let pins = TwinStylePins::default();
        let a = sample_anchors(&mut StdRng::seed_from_u64(7), &pins, None, &[]);
        let b = sample_anchors(&mut StdRng::seed_from_u64(7), &pins, None, &[]);
        assert_eq!(a.anchors, b.anchors);
    }

    #[test]
    fn fully_pinned_relaxes_instead_of_failing() {
        let pins = TwinStylePins {
            formality: Some(3),
            warmth: Some(3),
            humor: Some(2),
            energy: Some(3),
            length: Some(2),
            directness: Some(3),
            expressiveness: Some(2),
            detail: Some(3),
        };
        let draw = sample_anchors(&mut StdRng::seed_from_u64(1), &pins, None, &[]);
        assert!(draw.relaxed);
        assert!(draw
            .anchors
            .iter()
            .all(|a| *a == moderate_completion(&pins)));
    }

    #[test]
    fn coherence_rules() {
        let ok = dims_from([3, 3, 3, 3, 3, 3, 3, 3]);
        assert!(style_coherence_errors(&ok).is_empty());
        assert_eq!(
            style_coherence_errors(&dims_from([4, 3, 3, 3, 3, 3, 4, 3])).len(),
            1,
            "formal and expressive"
        );
        assert!(!style_coherence_errors(&dims_from([5, 3, 5, 3, 3, 3, 3, 3])).is_empty());
        assert!(!style_coherence_errors(&dims_from([1, 1, 1, 1, 3, 3, 3, 3])).is_empty());
        assert!(style_coherence_errors(&dims_from([1, 1, 1, 3, 3, 3, 3, 3])).is_empty());
        assert!(!style_coherence_errors(&dims_from([0, 3, 3, 3, 3, 3, 3, 6])).is_empty());
    }

    #[test]
    fn incoherent_pins_are_named() {
        let pins = TwinStylePins {
            formality: Some(5),
            humor: Some(5),
            ..TwinStylePins::default()
        };
        let errors = pin_errors(&pins);
        assert!(errors
            .iter()
            .any(|e| e.contains("humor 5 with formality 5")));
        let out_of_range = TwinStylePins {
            warmth: Some(9),
            ..TwinStylePins::default()
        };
        assert!(pin_errors(&out_of_range)[0].starts_with("pins.warmth: 9"));
    }
}
