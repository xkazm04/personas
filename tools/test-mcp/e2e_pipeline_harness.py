r"""
E2E Test: Pipeline Harness Upgrade

Tests the four pipeline executor enhancements:
  1. Deterministic command nodes (non-LLM shell execution)
  2. Conditional branching (condition met → node runs)
  3. Conditional branching (condition NOT met → node skipped)
  4. Approval gates (pipeline pauses, resumes on approval)

Prerequisites:
  - App running with test automation: npx tauri dev --features test-automation
  - At least 1 persona exists in the app (used as a shell for team members)

Usage:
  uvx --with httpx python tools/test-mcp/e2e_pipeline_harness.py
  uvx --with httpx python tools/test-mcp/e2e_pipeline_harness.py --port 17321
"""
import httpx
import json
import time
import sys
import io
import argparse

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

parser = argparse.ArgumentParser(description="E2E Pipeline Harness Upgrade tests")
parser.add_argument("--port", type=int, default=17320, help="Test automation server port")
args = parser.parse_args()

BASE = f"http://127.0.0.1:{args.port}"
c = httpx.Client(base_url=BASE, timeout=30)

passed = 0
failed = 0
results = []

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def test(name, fn):
    global passed, failed
    start = time.perf_counter()
    try:
        result = fn()
        ms = (time.perf_counter() - start) * 1000
        passed += 1
        results.append((name, "PASS", ms, result))
        print(f"  PASS  {name} ({ms:.0f}ms) -- {result}")
        return result
    except Exception as e:
        ms = (time.perf_counter() - start) * 1000
        failed += 1
        results.append((name, "FAIL", ms, str(e)))
        print(f"  FAIL  {name} ({ms:.0f}ms) -- {e}")
        return None


def eval_js(js_code):
    """Fire-and-forget JS execution in the WebView."""
    c.post("/eval", json={"js": js_code}, timeout=10)


DIV_ID = "__pe2e_out"


def _ensure_div():
    """Create the hidden readback div if it doesn't exist."""
    eval_js(
        f"if(!document.getElementById('{DIV_ID}'))"
        f"{{let e=document.createElement('div');e.id='{DIV_ID}';"
        f"e.style.display='none';document.body.appendChild(e);}}"
    )


def _write_to_div(js_expr):
    """Evaluate js_expr and write the result string to the readback div."""
    eval_js(
        f"(function(){{let e=document.getElementById('{DIV_ID}');"
        f"if(e)e.textContent={js_expr};}})()"
    )


def _read_div():
    """Read the hidden div's textContent."""
    r = c.post("/query", json={"selector": f"#{DIV_ID}"})
    elements = r.json()
    if elements and len(elements) > 0:
        return elements[0].get("text", "")
    return ""


def _poll_div(sentinel, timeout_s=15):
    """Poll the readback div until its text starts with sentinel."""
    for _ in range(timeout_s * 4):
        time.sleep(0.25)
        text = _read_div()
        if text.startswith(sentinel):
            return text
    return None


def ipc(cmd, args_dict, pick=None):
    """Invoke a Tauri command via eval_js and retrieve the result.

    Args:
        cmd: Tauri command name
        args_dict: Arguments to pass to invoke
        pick: Optional JS expression to extract from result (e.g., "r.id")
              If omitted, the full result is serialized. Use `pick` when the
              result is large (e.g., list_personas returns 70 objects) to
              avoid hitting the 300-char query truncation limit.
    """
    _ensure_div()
    _write_to_div("'__PENDING__'")
    time.sleep(0.1)

    args_json = json.dumps(args_dict)
    serialize = f"JSON.stringify({pick})" if pick else "JSON.stringify(r)"
    eval_js(f"""
    (async () => {{
      const d = document.getElementById('{DIV_ID}');
      try {{
        const r = await window.__TAURI_INTERNALS__.invoke('{cmd}', {args_json});
        if (d) d.textContent = 'OK:' + {serialize};
      }} catch (e) {{
        if (d) d.textContent = 'ERR:' + String(e);
      }}
    }})();
    """)

    for _ in range(60):  # 15 seconds
        time.sleep(0.25)
        text = _read_div()
        if text.startswith("OK:"):
            try:
                return json.loads(text[3:])
            except json.JSONDecodeError:
                return {"__raw__": text[3:]}
        if text.startswith("ERR:"):
            raise RuntimeError(f"IPC '{cmd}' failed: {text[4:]}")

    raise RuntimeError(f"IPC '{cmd}' timed out — no response")




def get_run_status(run_id):
    """Fetch just the run status (small payload, safe for DOM readback)."""
    return ipc("get_pipeline_run", {"id": run_id}, pick="{status:r.status}")


def get_run_nodes(run_id):
    """Fetch ONLY status + skip_reason per node (minimal payload).

    Each node returns `{status, skip_reason}`. Keeps well under 300-char limit
    for up to 4+ nodes. Use `get_run_node_outputs` and `get_run_node_member_ids`
    for additional fields when needed.
    """
    return ipc(
        "get_pipeline_run", {"id": run_id},
        pick=(
            "(JSON.parse(r.node_statuses||'[]')"
            ".map(n=>({status:n.status,skip_reason:n.skip_reason||''})))"
        ),
    )


def get_run_node_outputs(run_id):
    """Fetch just node outputs (short strings), one per node."""
    return ipc(
        "get_pipeline_run", {"id": run_id},
        pick=(
            "(JSON.parse(r.node_statuses||'[]')"
            ".map(n=>((n.output||'').substring(0,100))))"
        ),
    )


def get_run_node_member_ids(run_id):
    """Fetch just member_ids, one per node."""
    return ipc(
        "get_pipeline_run", {"id": run_id},
        pick=(
            "(JSON.parse(r.node_statuses||'[]')"
            ".map(n=>n.member_id))"
        ),
    )


def poll_pipeline_run(run_id, target_statuses, timeout_s=30):
    """Poll a pipeline run until its status is in target_statuses.

    Returns a dict with 'status' and 'nodes' (parsed list).
    """
    last_status = None
    for _ in range(timeout_s * 2):
        run = get_run_status(run_id)
        last_status = run.get("status")
        if last_status in target_statuses:
            nodes = get_run_nodes(run_id)
            return {"status": last_status, "nodes": nodes}
        time.sleep(0.5)
    raise RuntimeError(
        f"Pipeline run {run_id} did not reach {target_statuses} "
        f"within {timeout_s}s — stuck at '{last_status}'"
    )


def parse_node_statuses(run):
    """Return node list from a run dict (already parsed by poll_pipeline_run)."""
    if "nodes" in run:
        return run["nodes"]
    raw = run.get("node_statuses", "[]")
    if isinstance(raw, str):
        return json.loads(raw)
    return raw


def cleanup_team(team_id):
    """Delete a team (best-effort, swallows errors)."""
    try:
        # Cancel any running pipeline first
        ipc("cancel_pipeline", {"runId": "dummy"})
    except Exception:
        pass
    time.sleep(0.3)
    try:
        ipc("delete_team", {"id": team_id})
    except Exception:
        pass


# ---------------------------------------------------------------------------
# 0. Pre-flight
# ---------------------------------------------------------------------------
print("\n=== 0. Pre-flight ===")

def test_health():
    r = c.get("/health")
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "ok"
    return f"server={d['server']}"

test("Health check", test_health)


def test_get_persona():
    result = ipc("list_personas", {},
                  pick="{count:r.length,id0:r[0]?.id,id1:r[1]?.id,name:r[0]?.name}")
    assert result.get("count", 0) >= 2, "Need at least 2 personas — create more first"
    return f"{result['count']} personas available, using '{result.get('name')}' + one more"

persona_info = test("At least 2 personas exist", test_get_persona)


# Get two persona IDs for pipeline members (backend enforces uniqueness
# of team_id+persona_id, so multi-member tests need distinct personas).
SHELL_PERSONA_1 = None
SHELL_PERSONA_2 = None

def get_shell_persona_ids():
    global SHELL_PERSONA_1, SHELL_PERSONA_2
    result = ipc("list_personas", {},
                  pick="{count:r.length,id0:r[0]?.id,id1:r[1]?.id}")
    SHELL_PERSONA_1 = result["id0"]
    SHELL_PERSONA_2 = result["id1"]
    if not SHELL_PERSONA_1 or not SHELL_PERSONA_2:
        raise RuntimeError("Need at least 2 personas")
    return (SHELL_PERSONA_1, SHELL_PERSONA_2)

get_shell_persona_ids()


# ---------------------------------------------------------------------------
# 1. Command node — deterministic shell execution
# ---------------------------------------------------------------------------
print("\n=== 1. Command Node (deterministic) ===")

team1_id = None

def test_command_node_setup():
    global team1_id
    team1_id = ipc("create_team", {"input": {
        "name": "E2E-CmdNode", "color": "#10b981"
    }}, pick="r.id")

    # Add a command node that echoes JSON
    ipc("add_team_member", {
        "teamId": team1_id,
        "personaId": SHELL_PERSONA_1,
        "role": "worker",
        "positionX": 0.0,
        "positionY": 0.0,
        "config": json.dumps({
            "nodeType": "command",
            "command": "echo {\"result\":\"hello_from_command\"}"
        })
    }, pick="r.id")
    return f"team={team1_id}"

test("Create team with command node", test_command_node_setup)


def test_command_node_execute():
    run_id = ipc("execute_team", {"teamId": team1_id, "inputData": None})
    run = poll_pipeline_run(run_id, ["completed", "failed"], timeout_s=15)
    assert run["status"] == "completed", f"Expected completed, got {run['status']}"

    nodes = parse_node_statuses(run)
    assert len(nodes) == 1, f"Expected 1 node, got {len(nodes)}"
    assert nodes[0]["status"] == "completed", f"Node status: {nodes[0]['status']}"

    outputs = get_run_node_outputs(run_id)
    assert "hello_from_command" in str(outputs[0]), f"Output missing expected text: {outputs[0]}"
    return f"output contains 'hello_from_command'"

test("Command node executes and captures stdout", test_command_node_execute)

if team1_id:
    cleanup_team(team1_id)


# ---------------------------------------------------------------------------
# 2. Conditional branching — condition MET
# ---------------------------------------------------------------------------
print("\n=== 2. Conditional Branch (condition met) ===")

team2_id = None

def test_cond_met_setup():
    global team2_id
    team2_id = ipc("create_team", {"input": {
        "name": "E2E-CondMet", "color": "#6366f1"
    }}, pick="r.id")

    # Node 1: command that outputs type=feature
    m1_id = ipc("add_team_member", {
        "teamId": team2_id,
        "personaId": SHELL_PERSONA_1,
        "role": "worker",
        "positionX": 0.0, "positionY": 0.0,
        "config": json.dumps({
            "nodeType": "command",
            "command": "echo {\"type\":\"feature\",\"detail\":\"test\"}"
        })
    }, pick="r.id")

    # Node 2: command that echoes "reached" (different persona to avoid uniqueness constraint)
    m2_id = ipc("add_team_member", {
        "teamId": team2_id,
        "personaId": SHELL_PERSONA_2,
        "role": "worker",
        "positionX": 200.0, "positionY": 0.0,
        "config": json.dumps({
            "nodeType": "command",
            "command": "echo reached_node_2"
        })
    }, pick="r.id")

    # Conditional connection: m1 → m2, only if output contains "feature"
    # Uses `*` (whole-output mode) + contains to sidestep Windows cmd quote
    # mangling of JSON. Works cross-platform on raw stdout.
    ipc("create_team_connection", {
        "teamId": team2_id,
        "sourceMemberId": m1_id,
        "targetMemberId": m2_id,
        "connectionType": "conditional",
        "condition": json.dumps({"field": "*", "op": "contains", "value": "feature"}),
        "label": "if feature"
    }, pick="r.id")
    return f"team={team2_id}, m1={m1_id[:8]}, m2={m2_id[:8]}"

test("Create team: cmd→cmd with condition type=feature", test_cond_met_setup)


def test_cond_met_execute():
    run_id = ipc("execute_team", {"teamId": team2_id, "inputData": None})
    run = poll_pipeline_run(run_id, ["completed", "failed"], timeout_s=20)
    assert run["status"] == "completed", f"Expected completed, got {run['status']}"

    nodes = parse_node_statuses(run)
    assert len(nodes) == 2, f"Expected 2 nodes, got {len(nodes)}"

    statuses = [n["status"] for n in nodes]
    assert "completed" in statuses, f"No completed nodes: {statuses}"
    # Both should complete — condition type=feature matches output
    completed_count = statuses.count("completed")
    assert completed_count == 2, f"Expected 2 completed, got {completed_count}: {statuses}"
    return f"both nodes completed (condition met)"

test("Both nodes run when condition is met", test_cond_met_execute)

if team2_id:
    cleanup_team(team2_id)


# ---------------------------------------------------------------------------
# 3. Conditional branching — condition NOT met (skip)
# ---------------------------------------------------------------------------
print("\n=== 3. Conditional Branch (condition NOT met → skip) ===")

team3_id = None

def test_cond_skip_setup():
    global team3_id
    team3_id = ipc("create_team", {"input": {
        "name": "E2E-CondSkip", "color": "#ef4444"
    }}, pick="r.id")

    # Node 1: outputs type=feature
    m1_id = ipc("add_team_member", {
        "teamId": team3_id,
        "personaId": SHELL_PERSONA_1,
        "role": "worker",
        "positionX": 0.0, "positionY": 0.0,
        "config": json.dumps({
            "nodeType": "command",
            "command": "echo {\"type\":\"feature\"}"
        })
    }, pick="r.id")

    # Node 2: should be SKIPPED because condition requires type=bug
    m2_id = ipc("add_team_member", {
        "teamId": team3_id,
        "personaId": SHELL_PERSONA_2,
        "role": "worker",
        "positionX": 200.0, "positionY": 0.0,
        "config": json.dumps({
            "nodeType": "command",
            "command": "echo should_not_run"
        })
    }, pick="r.id")

    # Conditional connection: m1 → m2, requires output to contain "bug" (won't match)
    ipc("create_team_connection", {
        "teamId": team3_id,
        "sourceMemberId": m1_id,
        "targetMemberId": m2_id,
        "connectionType": "conditional",
        "condition": json.dumps({"field": "*", "op": "contains", "value": "bug"}),
        "label": "if bug"
    }, pick="r.id")
    return f"team={team3_id}, condition requires 'bug' in output but output is 'feature'"

test("Create team: cmd→cmd with unmet condition", test_cond_skip_setup)


def test_cond_skip_execute():
    run_id = ipc("execute_team", {"teamId": team3_id, "inputData": None})
    run = poll_pipeline_run(run_id, ["completed", "failed"], timeout_s=20)

    nodes = parse_node_statuses(run)
    assert len(nodes) == 2, f"Expected 2 nodes, got {len(nodes)}"

    statuses = [n["status"] for n in nodes]
    assert "completed" in statuses, f"No completed node: {statuses}"
    assert "skipped" in statuses, f"No skipped node: {statuses}"

    # Verify the skipped node has the right reason
    skipped_node = next(n for n in nodes if n["status"] == "skipped")
    skip_reason = skipped_node.get("skip_reason", "")
    assert skip_reason == "condition_not_met", f"Wrong skip reason: {skip_reason}"
    return f"node1=completed, node2=skipped (condition_not_met)"

test("Node 2 skipped when condition not met", test_cond_skip_execute)

if team3_id:
    cleanup_team(team3_id)


# ---------------------------------------------------------------------------
# 4. Approval gate — pause and resume
# ---------------------------------------------------------------------------
print("\n=== 4. Approval Gate ===")

team4_id = None

def test_approval_setup():
    global team4_id
    team4_id = ipc("create_team", {"input": {
        "name": "E2E-Approval", "color": "#f59e0b"
    }}, pick="r.id")

    # Single command node with approval gate
    ipc("add_team_member", {
        "teamId": team4_id,
        "personaId": SHELL_PERSONA_1,
        "role": "worker",
        "positionX": 0.0, "positionY": 0.0,
        "config": json.dumps({
            "nodeType": "command",
            "command": "echo approved_output",
            "approvalGate": True
        })
    }, pick="r.id")
    return f"team={team4_id}, single node with approvalGate=true"

test("Create team with approval gate node", test_approval_setup)


APPROVAL_RUN_ID = None

def test_approval_pauses():
    global APPROVAL_RUN_ID
    run_id = ipc("execute_team", {"teamId": team4_id, "inputData": None})
    APPROVAL_RUN_ID = run_id

    # Poll until we see awaiting_approval status
    for _ in range(20):
        time.sleep(0.5)
        status = get_run_status(run_id).get("status")
        nodes = get_run_nodes(run_id)
        statuses = [n["status"] for n in nodes]
        if "awaiting_approval" in statuses:
            return f"run_id={run_id}, pipeline paused at approval gate"
        if status in ("completed", "failed", "cancelled"):
            raise AssertionError(
                f"Pipeline finished without pausing: status={status}, nodes={statuses}"
            )

    raise AssertionError("Pipeline did not reach awaiting_approval within 10s")

test("Pipeline pauses at approval gate", test_approval_pauses)


def test_approval_resumes():
    run_id = APPROVAL_RUN_ID
    assert run_id, "No approval run tracked"
    nodes = get_run_nodes(run_id)
    member_ids = get_run_node_member_ids(run_id)

    # Find the index of the awaiting node, then look up its member_id
    awaiting_idx = [i for i, n in enumerate(nodes) if n["status"] == "awaiting_approval"]
    assert len(awaiting_idx) == 1, f"Expected 1 awaiting node, got {len(awaiting_idx)}"
    member_id = member_ids[awaiting_idx[0]]

    # Approve the node
    ipc("approve_pipeline_node", {"runId": run_id, "memberId": member_id})

    # Poll until pipeline completes
    run = poll_pipeline_run(run_id, ["completed", "failed"], timeout_s=15)
    assert run["status"] == "completed", f"Expected completed after approval, got {run['status']}"

    nodes = parse_node_statuses(run)
    assert nodes[0]["status"] == "completed"
    outputs = get_run_node_outputs(run_id)
    assert "approved_output" in str(outputs[0]), f"Missing expected output: {outputs[0]}"
    return f"pipeline completed after approval, output correct"

test("Approving gate resumes pipeline to completion", test_approval_resumes)

if team4_id:
    cleanup_team(team4_id)


# ---------------------------------------------------------------------------
# 5. Model override — verify config is parsed (structural test)
# ---------------------------------------------------------------------------
print("\n=== 5. Model Override Config (structural) ===")

team5_id = None

def test_model_override_config():
    """Verify a command node with modelProfileOverride parses correctly.

    We can't test actual model routing without a real LLM, but we CAN verify
    that a node with both nodeType=command and modelProfileOverride runs the
    command path (modelProfileOverride is irrelevant for command nodes but
    should not break anything).
    """
    global team5_id
    team5_id = ipc("create_team", {"input": {
        "name": "E2E-ModelOverride", "color": "#8b5cf6"
    }}, pick="r.id")

    ipc("add_team_member", {
        "teamId": team5_id,
        "personaId": SHELL_PERSONA_1,
        "role": "worker",
        "positionX": 0.0, "positionY": 0.0,
        "config": json.dumps({
            "nodeType": "command",
            "command": "echo config_parsed_ok",
            "modelProfileOverride": "claude-haiku"
        })
    }, pick="r.id")

    run_id = ipc("execute_team", {"teamId": team5_id, "inputData": None})
    run = poll_pipeline_run(run_id, ["completed", "failed"], timeout_s=15)
    assert run["status"] == "completed"

    outputs = get_run_node_outputs(run_id)
    assert "config_parsed_ok" in str(outputs[0]), f"Missing expected output: {outputs[0]}"
    return "command node with modelProfileOverride runs without error"

test("NodeConfig with modelProfileOverride parses correctly", test_model_override_config)

if team5_id:
    cleanup_team(team5_id)


# ---------------------------------------------------------------------------
# 6. UI verification — Teams page shows pipeline status
# ---------------------------------------------------------------------------
print("\n=== 6. UI Verification ===")

def test_teams_page_loads():
    r = c.post("/navigate", json={"section": "team"})
    assert r.status_code == 200
    time.sleep(0.5)
    snap = c.get("/snapshot").json()
    # The route may vary — just verify no error
    assert snap.get("error") is None or snap.get("error") == "", f"Error: {snap.get('error')}"
    return f"route={snap.get('route')}"

test("Teams page loads", test_teams_page_loads)


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
print(f"\n{'=' * 60}")
print(f"  Pipeline Harness E2E: {passed} passed, {failed} failed")
print(f"{'=' * 60}")

for name, status, ms, detail in results:
    icon = "+" if status == "PASS" else "-"
    print(f"  [{icon}] {name} ({ms:.0f}ms)")

if failed > 0:
    print(f"\n  FAILURES:")
    for name, status, ms, detail in results:
        if status == "FAIL":
            print(f"    {name}: {detail}")

sys.exit(1 if failed else 0)
