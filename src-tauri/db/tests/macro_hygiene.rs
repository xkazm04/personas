//! The exported `db` macros must expand correctly OUTSIDE this crate.
//!
//! A `#[macro_export]` body resolves its names where it expands, so a macro
//! that works at every in-crate call site can still depend on the caller's
//! imports (a bare `push_field!`, `timed_query!` or `rusqlite::`) or be broken
//! by an ordinary alias in the caller's scope (`type Result<T>`). In-crate call
//! sites cannot see either. This file is a foreign crate: every macro is invoked
//! by path, nothing from `personas_db` is imported, and `Result` is shadowed.
//! It compiles only while the bodies spell every name they need from a root.
#![allow(dead_code)]

/// An alias a caller may reasonably have in scope. The macros must not see it.
type Result<T> = ::std::result::Result<T, String>;

pub struct Thing {
    pub id: String,
    pub name: String,
    pub flag: bool,
    pub note: Option<String>,
}

pub struct ThingUpdate {
    pub name: Option<String>,
    pub flag: Option<bool>,
}

pub struct Run {
    pub id: String,
}

pub struct Res {
    pub id: String,
}

personas_db::row_mapper!(row_to_thing -> Thing { id, name, flag [bool], note [opt] });
personas_db::row_mapper!(row_to_run -> Run { id });
personas_db::row_mapper!(row_to_res -> Res { id });

mod things {
    use super::{row_to_thing, Thing, ThingUpdate};
    type Result<T> = ::std::result::Result<T, String>;

    personas_db::crud_get_by_id!(Thing, "things", "Thing", row_to_thing);
    personas_db::crud_get_all!(Thing, "things", row_to_thing, "id");
    personas_db::crud_delete!("things");
    personas_db::crud_update! {
        model: Thing,
        table: "things",
        input: ThingUpdate,
        fields: { name: clone, flag: bool }
    }
}

mod lab {
    use super::{row_to_res, row_to_run, Res, Run};

    personas_db::lab_crud! {
        run_table: "r",
        result_table: "rr",
        run_type: Run,
        result_type: Res,
        run_entity: "Run",
        result_entity: "Res",
        result_order: "id",
        run_mapper: row_to_run,
        result_mapper: row_to_res,
    }
}

#[test]
fn generated_items_stay_visible_to_the_caller() {
    // The macros must not hide what the invocation asked for.
    let _ = (
        things::get_by_id,
        things::get_all,
        things::delete,
        things::update,
    );
    let _ = (
        lab::get_run_by_id,
        lab::get_runs_by_persona,
        lab::update_run_status,
    );
    let _ = (lab::update_progress, lab::delete_run, lab::get_result_by_id);
    let _ = lab::get_results_by_run;
    let _ = (row_to_thing, row_to_run, row_to_res);
}

#[test]
fn set_clause_macros_expand_by_path() {
    let name: Option<String> = Some("a".into());
    let flag: Option<bool> = None;
    let mut sets: Vec<String> = Vec::new();
    let mut param_idx = 2u32;
    let mut params = Vec::new();
    personas_db::push_field!(flag, "flag", sets, param_idx);
    personas_db::push_field_param!(name, "name", sets, param_idx, params, clone);
    assert_eq!(sets, vec!["name = ?2".to_string()]);
    assert_eq!(param_idx, 3);
    assert_eq!(params.len(), 1);
}

#[test]
fn timed_query_expands_by_path() {
    let r: Result<u32> = personas_db::timed_query!("things", "things::probe", { Ok(2) });
    assert_eq!(r, Ok(2));
}
