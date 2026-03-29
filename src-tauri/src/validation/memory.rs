use super::contract::{ValidationError, ValidationRule};

pub const IMPORTANCE_MIN: i32 = 1;
pub const IMPORTANCE_MAX: i32 = 5;
pub const MEMORY_CATEGORIES: &[&str] = &[
    "fact", "preference", "instruction", "context", "learned", "constraint",
];

pub fn validate_importance(value: i32) -> Vec<ValidationError> {
    if (IMPORTANCE_MIN..=IMPORTANCE_MAX).contains(&value) {
        vec![]
    } else {
        vec![ValidationError::new(
            "importance",
            "range",
            format!("Importance must be between {IMPORTANCE_MIN} and {IMPORTANCE_MAX}, got {value}"),
        )]
    }
}

pub fn validate_category(value: &str) -> Vec<ValidationError> {
    if MEMORY_CATEGORIES.contains(&value) {
        vec![]
    } else {
        vec![ValidationError::new(
            "category",
            "allowed_values",
            format!(
                "Invalid memory category '{value}'. Valid categories: {}",
                MEMORY_CATEGORIES.join(", ")
            ),
        )]
    }
}

// -- Rule catalog -------------------------------------------------------------

pub fn rules() -> Vec<ValidationRule> {
    vec![
        ValidationRule::new("memory", "importance", "range", format!("Must be between {IMPORTANCE_MIN} and {IMPORTANCE_MAX}"))
            .with_range(IMPORTANCE_MIN as f64, IMPORTANCE_MAX as f64),
        ValidationRule::new("memory", "category", "allowed_values", "Must be a valid memory category")
            .with_allowed(MEMORY_CATEGORIES.iter().map(|s| s.to_string()).collect()),
    ]
}
