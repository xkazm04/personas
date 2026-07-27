//! Orchestration repos — team assignments, steps, audit events.
//!
//! Phase A surface: CRUD over `team_assignments`, `team_assignment_steps`,
//! `team_assignment_events`. The engine module
//! `engine::team_assignment_orchestrator` calls into this repo to advance
//! state; Tauri commands (Phase A2) wrap it for the frontend.

pub mod team_assignments;
