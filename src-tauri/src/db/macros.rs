/// Build a dynamic SQL SET clause field-by-field.
///
/// Checks if an `Option` value is `Some`, and if so, appends
/// `"column = ?N"` to `sets` and increments `param_idx`.
///
/// # Usage
///
/// ```ignore
/// // With an `input` struct whose fields are Option<T>:
/// push_field!(input.name, "name", sets, param_idx);
///
/// // With a local Option variable:
/// push_field!(my_var, "column_name", sets, param_idx);
/// ```
#[macro_export]
macro_rules! push_field {
    ($field:expr, $col:literal, $sets:expr, $param_idx:expr) => {
        if $field.is_some() {
            $sets.push(format!("{} = ?{}", $col, $param_idx));
            $param_idx += 1;
        }
    };
}
