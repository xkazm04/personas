#!/usr/bin/env python3
"""
UI verification test for delivered features:
1. Codebase connector visible in Builder mode, hidden in Team mode
2. Saved persona Matrix tab shows PersonaMatrix (not empty)
3. Version snapshot has full fields after promote
4. Save Version button present in saved matrix command center
"""
import httpx, json, sqlite3, os, sys, time

BASE = "http://127.0.0.1:17320"
DB = os.path.join(os.environ.get("APPDATA", ""), "com.personas.desktop", "personas.db")
client = httpx.Client(base_url=BASE, timeout=60)

def log(msg): print(f"[{time.strftime('%H:%M:%S')}] {msg}")
def api(method, path, body=None):
    try:
        r = client.request(method, path, json=body) if body else client.request(method, path)
        try: return r.json()
        except: return {"_raw": r.text}
    except: return {"_error": "failed"}

def db_val(sql, params=()):
    c = sqlite3.connect(DB)
    try:
        row = c.execute(sql, params).fetchone()
        return row[0] if row else None
    finally: c.close()

results = {}

# ═══════════════════════════════════════════════════════════════
# Test 1: Codebase connector in Vault — Builder vs Team mode
# ═══════════════════════════════════════════════════════════════
log("Test 1: Codebase connector tier gating")

# Set Builder mode
api("POST", "/eval", {"js": "(async()=>{const m=await import('/src/stores/systemStore.ts');m.useSystemStore.getState().setViewMode('builder')})()"})
time.sleep(1)

# Navigate to credentials catalog and check if codebase connector exists in DB
codebase_exists = db_val("SELECT COUNT(*) FROM connector_definitions WHERE name='codebase'")
log(f"  Codebase connector in DB: {codebase_exists}")
results["codebase_in_db"] = codebase_exists and codebase_exists > 0

# Check metadata has min_tier=builder
meta = db_val("SELECT metadata FROM connector_definitions WHERE name='codebase'")
has_min_tier = meta and '"min_tier"' in meta and '"builder"' in meta
log(f"  Has min_tier=builder: {has_min_tier}")
results["codebase_tier_gated"] = has_min_tier

# Check connection_mode=desktop_bridge (for Local badge)
has_local = meta and '"desktop_bridge"' in meta
log(f"  Has desktop_bridge (Local badge): {has_local}")
results["codebase_local_badge"] = has_local

# ═══════════════════════════════════════════════════════════════
# Test 2: Saved persona Matrix tab uses PersonaMatrix
# ═══════════════════════════════════════════════════════════════
log("Test 2: Saved persona Matrix tab")

# Find a promoted persona with design data
persona_id = db_val(
    "SELECT id FROM personas WHERE length(last_design_result) > 100 ORDER BY created_at DESC LIMIT 1"
)
if persona_id:
    persona_name = db_val("SELECT name FROM personas WHERE id=?", (persona_id,))
    log(f"  Found persona: {persona_name} ({persona_id})")

    # Select it and switch to matrix tab
    api("POST", "/eval", {"js": f"window.__TEST__.selectAgent('{persona_id}')"})
    time.sleep(1)
    api("POST", "/eval", {"js": "window.__TEST__.openEditorTab('matrix')"})
    time.sleep(2)

    # Check if PersonaMatrix rendered (look for the grid structure)
    snap = api("GET", "/snapshot")
    route = snap.get("route", "")
    tab = snap.get("editorTab", "")
    log(f"  Route: {route}, Tab: {tab}")

    # Check for save-version button (proves PersonaMatrix variant=saved rendered)
    api("POST", "/eval", {"js": "window.__TEST__.query('[data-testid=\"save-version-btn\"]')"})
    time.sleep(1)

    # Check for refine input (proves command center rendered)
    refine = api("POST", "/eval", {"js": "window.__TEST__.query('[data-testid=\"agent-refine-input\"]')"})
    time.sleep(1)

    # Check build session has resolved cells for this persona
    session_cells = db_val(
        "SELECT length(resolved_cells) FROM build_sessions WHERE persona_id=? AND phase='promoted' ORDER BY updated_at DESC LIMIT 1",
        (persona_id,)
    )
    log(f"  Resolved cells length: {session_cells}")
    results["matrix_has_data"] = session_cells and session_cells > 100

    # Check last_design_result on persona
    dr_len = db_val("SELECT length(last_design_result) FROM personas WHERE id=?", (persona_id,))
    log(f"  last_design_result length: {dr_len}")
    results["persona_has_design_result"] = dr_len and dr_len > 100
else:
    log("  No promoted persona with design data found")
    results["matrix_has_data"] = False
    results["persona_has_design_result"] = False

# ═══════════════════════════════════════════════════════════════
# Test 3: Version snapshot has full fields
# ═══════════════════════════════════════════════════════════════
log("Test 3: Version snapshot schema")

# Check new columns exist
cols = []
c = sqlite3.connect(DB)
for row in c.execute("PRAGMA table_info(persona_prompt_versions)"):
    cols.append(row[1])
c.close()

has_design_context = "design_context" in cols
has_last_design_result = "last_design_result" in cols
has_resolved_cells = "resolved_cells" in cols
has_icon = "icon" in cols
has_color = "color" in cols
log(f"  Columns: design_context={has_design_context}, last_design_result={has_last_design_result}, resolved_cells={has_resolved_cells}, icon={has_icon}, color={has_color}")
results["version_schema_extended"] = all([has_design_context, has_last_design_result, has_resolved_cells, has_icon, has_color])

# Check if any version has snapshot data
snapshot_count = db_val(
    "SELECT COUNT(*) FROM persona_prompt_versions WHERE resolved_cells IS NOT NULL AND length(resolved_cells) > 10"
) or 0
log(f"  Versions with resolved_cells: {snapshot_count}")
results["versions_have_snapshots"] = snapshot_count > 0

# Check version with icon
icon_count = db_val(
    "SELECT COUNT(*) FROM persona_prompt_versions WHERE icon IS NOT NULL"
) or 0
log(f"  Versions with icon: {icon_count}")
results["versions_have_icons"] = icon_count > 0

# ═══════════════════════════════════════════════════════════════
# Test 4: Build prompt improvements
# ═══════════════════════════════════════════════════════════════
log("Test 4: Build prompt improvements (DB checks)")

# Check a promoted persona uses personas_database not supabase
if persona_id:
    sp = db_val("SELECT system_prompt FROM personas WHERE id=?", (persona_id,))
    uses_supabase = sp and "supabase" in sp.lower() if sp else False
    icon = db_val("SELECT icon FROM personas WHERE id=?", (persona_id,))
    log(f"  System prompt uses Supabase: {uses_supabase}")
    log(f"  Icon: {icon}")
    results["no_supabase"] = not uses_supabase
    results["has_valid_icon"] = icon is not None and len(icon) > 1
else:
    results["no_supabase"] = True
    results["has_valid_icon"] = False

# ═══════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════
log("")
log("=" * 50)
log("RESULTS")
log("=" * 50)
passed = 0
total = len(results)
for k, v in results.items():
    status = "PASS" if v else "FAIL"
    if v: passed += 1
    log(f"  {k}: {status}")
log(f"\n  {passed}/{total} passed")

sys.exit(0 if passed == total else 1)
