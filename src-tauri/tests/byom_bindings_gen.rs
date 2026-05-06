//! Regenerate BYOM TypeScript bindings that are used as frontend contracts.

use app_lib::EngineKind;
use ts_rs::TS;

#[test]
fn export_byom_bindings() {
    EngineKind::export_all().expect("export EngineKind");
}
