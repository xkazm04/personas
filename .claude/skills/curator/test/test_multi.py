"""The /curator --multi validator: every rule here was a measured seat failure (2026-10-12)."""

import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import multi as M  # noqa: E402

FILES = M.Files()
REL = "package.json"
LINES = FILES.lines(REL)
N = next(i for i, l in enumerate(LINES, 1) if '"name"' in l)
QUOTE = LINES[N - 1].strip()
SECOND = next(i for i, l in enumerate(LINES, 1) if '"version"' in l)
QUOTE2 = LINES[SECOND - 1].strip()
DOSSIER = {
    "domain": "software-engineering", "slug": "s",
    "techniques": [{"slug": t} for t in ("t1", "t2", "t3", "t4")],
    "pairs": [{"context": "ctx-a", "context_id": "id-a", "files": ["src/a.ts"]},
              {"context": "ctx-b", "context_id": "id-b", "files": ["src/b.ts"]}],
}


def tech(slug, verdict, n=N, q=QUOTE):
    return {"technique": slug, "verdict": verdict, "anchor": f"{REL}:{n}", "quote": q, "note": "n"}


def pair(ctx, state, techs, n=N, q=QUOTE):
    return {"context": ctx, "state": state, "anchor": f"{REL}:{n}", "quote": q,
            "consequence": "a consequence sentence long enough", "techniques": techs, "registryProposal": ""}


def answer(*pairs, notes=""):
    return {"subject": "s", "pairs": list(pairs), "declined": [], "notes": notes}


class Anchors(unittest.TestCase):
    def test_exact(self):
        self.assertEqual(M.check_anchor(FILES, f"{REL}:{N}", QUOTE), (f"{REL}:{N}", None, None))

    def test_absolute_windows_path_is_repaired_not_refused(self):
        fixed, _, bad = M.check_anchor(FILES, "C:\\Users\\kazda\\kiro\\personas\\" + f"{REL}:{N}", QUOTE)
        self.assertIsNone(bad)
        self.assertEqual(fixed, f"{REL}:{N}")

    def test_off_by_one_line_is_repaired(self):
        fixed, rep, bad = M.check_anchor(FILES, f"{REL}:{N + 1}", QUOTE)
        self.assertEqual((fixed, bad), (f"{REL}:{N}", None))
        self.assertIn("->", rep)

    def test_quote_found_nowhere_is_refused(self):
        self.assertIsNotNone(M.check_anchor(FILES, f"{REL}:{N}", "this text is in no line of the file")[2])

    def test_placeholder_and_untracked(self):
        self.assertIsNotNone(M.check_anchor(FILES, "src/x/y.ts:41", "whatever text")[2])
        self.assertIsNotNone(M.check_anchor(FILES, "no/such/file.ts:1", "whatever text")[2])


class Validate(unittest.TestCase):
    def test_read_nothing_refuses_the_whole_answer(self):
        v = M.validate(answer(pair("ctx-a", "deviation", [tech("t1", "deviation")])), DOSSIER, FILES,
                       "claude answered in 1 turn(s): no file was opened")
        self.assertEqual(v["pairs"], [])
        self.assertEqual(len(v["declined"]), 2)

    def test_self_disclaimer_refuses_but_scope_notes_do_not(self):
        bad = answer(pair("ctx-a", "deviation", [tech("t1", "deviation")]), notes="DRAFT ONLY - do not keep")
        self.assertEqual(M.validate(bad, DOSSIER, FILES)["pairs"], [])
        honest = answer(pair("ctx-a", "deviation", [tech("t1", "deviation")]),
                        notes="enforcement was not verified; empty fields contain no placeholder anchors")
        self.assertEqual(len(M.validate(honest, DOSSIER, FILES)["pairs"]), 1)

    def test_floor_counts_distinct_anchors(self):
        # four techniques, floor 2: one anchor reused four times is ONE piece of evidence
        padded = answer(pair("ctx-a", "conformant", [tech(t, "conformant") for t in ("t1", "t2", "t3", "t4")]))
        self.assertEqual(M.validate(padded, DOSSIER, FILES)["pairs"], [])
        real = answer(pair("ctx-a", "conformant", [tech("t1", "conformant"), tech("t2", "conformant", SECOND, QUOTE2)]))
        self.assertEqual(len(M.validate(real, DOSSIER, FILES)["pairs"]), 1)

    def test_conformant_with_a_deviating_technique_is_declined(self):
        a = answer(pair("ctx-a", "conformant", [tech("t1", "conformant"), tech("t2", "deviation", SECOND, QUOTE2)]))
        self.assertEqual(M.validate(a, DOSSIER, FILES)["pairs"], [])

    def test_smear_across_contexts_is_declined(self):
        a = answer(pair("ctx-a", "deviation", [tech("t1", "deviation")]),
                   pair("ctx-b", "deviation", [tech("t1", "deviation")]))
        v = M.validate(a, DOSSIER, FILES)
        self.assertEqual(v["pairs"], [])
        self.assertTrue(any("repo-wide" in r for r in v["rejections"]))

    def test_unknown_context_and_unknown_state_become_declines(self):
        v = M.validate(answer(pair("elsewhere", "deviation", []), pair("ctx-a", "unknown", [])), DOSSIER, FILES)
        self.assertEqual(v["pairs"], [])
        self.assertEqual([d["context"] for d in v["declined"]], ["ctx-a"])


class Absence(unittest.TestCase):
    """not-applicable must name its search, and the driver re-runs it (night 2026-10-12: 26% of
    one seat's not-applicable verdicts were withdrawn, most one grep away from contradiction)."""

    def setUp(self):
        import subprocess
        import tempfile
        self.dir = pathlib.Path(tempfile.mkdtemp(prefix="curator-absence-"))
        g = lambda *a: subprocess.run(["git", "-C", str(self.dir), *a], capture_output=True, text=True, check=True)
        g("init", "-q")
        (self.dir / "src" / "feature").mkdir(parents=True)
        (self.dir / "src" / "feature" / "a.ts").write_text("export const a = 1; // the main entry\n")
        (self.dir / "src" / "feature" / "b.ts").write_text("const tools = readMcpManifest();\n")
        g("add", "-A")
        self.files = M.Files(self.dir)
        self.d = {"domain": "software-engineering", "slug": "s", "techniques": [{"slug": "t1"}],
                  "pairs": [{"context": "feat", "context_id": "f", "files": ["src/feature/a.ts"]}]}

    def tearDown(self):
        import shutil
        shutil.rmtree(self.dir, ignore_errors=True)

    def na(self, terms):
        a = {"subject": "s", "notes": "", "declined": [], "pairs": [{
            "context": "feat", "state": "not-applicable", "anchor": "src/feature/a.ts:1",
            "quote": "export const a = 1; // the main entry", "consequence": "nothing in this context serves tools",
            "techniques": [], "registryProposal": "", "absence_terms": terms}]}
        return M.validate(a, self.d, self.files)

    def test_a_hit_in_a_sibling_file_refuses_the_absence(self):
        v = self.na(["mcp", "tool registry"])
        self.assertEqual(v["pairs"], [])
        self.assertTrue(any("absence contradicted" in r and "b.ts" in r for r in v["rejections"]), v["rejections"])

    def test_a_clean_search_lands_with_its_terms(self):
        v = self.na(["websocket", "stream"])
        self.assertEqual(len(v["pairs"]), 1)
        self.assertEqual(v["pairs"][0]["absenceTerms"], ["websocket", "stream"])

    def test_registry_jargon_is_not_a_search(self):
        """2026-10-13: terms like `dated-capability-matrix` can never appear in code, so a
        grep for them 'proves' every absence."""
        self.d["techniques"] = [{"slug": "dated-capability-matrix"}, {"slug": "output-normalization"}]
        self.assertEqual(M.jargon_terms(self.d, ["dated-capability-matrix", "capability-matrix", "spawnSync",
                                                 "output normalization"]),
                         ["dated-capability-matrix", "capability-matrix", "output normalization"])
        v = self.na(["dated-capability-matrix", "output-normalization", "websocket"])
        self.assertEqual(v["pairs"], [])  # one real term left: below the two-term floor

    def test_provider_policy_refuses_a_restricted_state(self):
        a = {"subject": "s", "notes": "", "declined": [], "pairs": [{
            "context": "feat", "state": "not-applicable", "anchor": "src/feature/a.ts:1",
            "quote": "export const a = 1; // the main entry", "consequence": "nothing in this context serves tools",
            "techniques": [], "registryProposal": "", "absence_terms": ["websocket", "stream"]}]}
        from unittest import mock
        with mock.patch.dict(M.PROVIDER_POLICY, {"restricted": {"not-applicable": "decline"}}):
            self.assertEqual(M.validate(a, self.d, self.files, provider="restricted")["pairs"], [])
            self.assertEqual(len(M.validate(a, self.d, self.files, provider="claude")["pairs"]), 1)
            self.assertIn("not accepted", M.brief({**self.d, "repo_root": str(self.dir), "golden": "g",
                                                   "applications": [], "techniques": [{"slug": "t1", "file": "f", "use_when": []}],
                                                   "pairs": []}, "restricted"))

    def test_no_terms_is_declined(self):
        self.assertEqual(self.na([])["pairs"], [])
        self.assertEqual(self.na(["ws"])["pairs"], [])  # too short to be a search


class Envelope(unittest.TestCase):
    def test_last_json_object_skips_a_placeholder_draft(self):
        text = 'thinking {"pairs": [], "subject": "placeholder"} then {"pairs": [1], "subject": "s"}'
        self.assertEqual(M._last_json_object(text)["pairs"], [1])

    def test_capacity_is_transient_not_a_verdict(self):
        err = '{"type": "turn.failed", "error": {"message": "Selected model is at capacity. Please try a different model."}}'
        self.assertEqual(M.seat_transient("", "", err), "at capacity")
        self.assertIsNone(M.seat_transient("finished judging", "", ""))

    def test_limit_only_without_an_answer(self):
        self.assertTrue(M.seat_limited("", "You've hit your usage limit", 1, None))
        self.assertFalse(M.seat_limited("about rate limiting", "", 0, {"pairs": [{}]}))


class Commit(unittest.TestCase):
    """commit_repo commits ONLY the conform files, on the checked-out branch, and refuses a detached HEAD."""

    def setUp(self):
        import subprocess
        import tempfile
        self.sp = subprocess
        self.dir = pathlib.Path(tempfile.mkdtemp(prefix="curator-commit-"))
        g = lambda *a: subprocess.run(["git", "-C", str(self.dir), *a], capture_output=True, text=True, check=True)
        self.g = g
        g("init", "-q", "-b", "main")
        g("config", "user.email", "t@example.com")
        g("config", "user.name", "t")
        (self.dir / ".ai" / "conform-runs" / "merged").mkdir(parents=True)
        (self.dir / ".ai" / "registry-map.json").write_text("{}\n")
        (self.dir / "other.txt").write_text("a\n")
        g("add", "-A")
        g("commit", "-q", "-m", "init")

    def tearDown(self):
        import shutil
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_commits_only_conform_files(self):
        (self.dir / ".ai" / "registry-map.json").write_text('{"x": 1}\n')
        (self.dir / ".ai" / "conform-runs" / "merged" / "r1.json").write_text("{}\n")
        (self.dir / "other.txt").write_text("sibling's unstaged edit\n")
        out = M.commit_repo(self.dir, ["r1.json"], "conform: test round")
        self.assertTrue(out["ok"], out)
        self.assertEqual(out["branch"], "main")
        files = self.g("show", "--name-only", "--format=", "HEAD").stdout.split()
        self.assertEqual(sorted(files), [".ai/conform-runs/merged/r1.json", ".ai/registry-map.json"])
        self.assertIn("sibling", (self.dir / "other.txt").read_text())  # untouched, still dirty
        self.assertIn("Co-Authored-By", self.g("log", "-1", "--format=%B").stdout)

    def test_a_message_swapped_by_a_sibling_is_found_and_noted(self):
        """systedo-case 2026-10-13: COMMIT_EDITMSG is shared, and our commit landed under a sibling's
        subject. It must be reported as ours (with a note), not as a failure."""
        (self.dir / ".ai" / "registry-map.json").write_text('{"x": 3}\n')
        self.g("add", ".ai/registry-map.json")
        self.g("commit", "-q", "-m", "refactor(app): somebody else's subject")
        out = M._find_replaced_message(self.dir, [".ai/registry-map.json", ".ai/conform-detail.json"],
                                       "chore(registry-map): add 1 x conform verdicts")
        self.assertTrue(out and out["ok"], out)
        self.assertEqual(out["message_replaced"], "refactor(app): somebody else's subject")
        self.assertIn("add 1 x conform verdicts", self.g("notes", "--ref=curator", "show", "HEAD").stdout)

    def test_nothing_to_commit(self):
        self.assertTrue(M.commit_repo(self.dir, [], "conform: nothing").get("nothing"))

    def test_pre_existing_dirt_is_committed_as_found(self):
        (self.dir / ".ai" / "registry-map.json").write_text('{"rebuilt": true}\n')
        out = M.commit_as_found(self.dir, 7)
        self.assertTrue(out["ok"], out)
        self.assertEqual("chore(registry-map): commit conform state found uncommitted",
                         self.g("log", "-1", "--format=%s").stdout.strip())
        self.assertIn("round 7", self.g("log", "-1", "--format=%b").stdout)
        body = self.g("log", "-1", "--format=%B").stdout
        for key in ("Agent-model: none", "Agent-harness: curator-multi@", "Agent-prompt: sha256:", "Agent-run: local"):
            self.assertIn(key, body)

    def test_messages_pass_the_consumer_repos_own_gates(self):
        """The real gates, when the repos are on this machine: kp's conventional/provenance gate,
        systedo-case's subject and attribution gates. Both refused night commits on 2026-10-12."""
        import os
        import subprocess
        import tempfile
        kiro = pathlib.Path(M.L.PERSONAS_ROOT).parent
        gates = [(kiro / "kp", ["scripts/release/commit-msg.mjs", "--file"]),
                 (kiro / "systedo-case", ["scripts/commit-check.mjs"]),
                 (kiro / "systedo-case", ["scripts/commit-attribution.mjs", "--check"])]
        gates = [(r, g) for r, g in gates if (r / g[0]).exists()]
        if not gates:
            self.skipTest("no consumer repo gates on this machine")
        subject = "chore(registry-map): add 5 quality-gates conform verdicts"
        msg = f"{subject}\n\nbody\n\n{M.provenance('gpt-6.1-sol', M.sha256_text('brief'))}\n"
        fd, path = tempfile.mkstemp(suffix=".txt")
        os.close(fd)
        pathlib.Path(path).write_text(msg, encoding="utf-8")
        try:
            for repo, gate in gates:
                r = subprocess.run(["node", *gate, path], cwd=repo, capture_output=True, text=True)
                self.assertEqual(r.returncode, 0, f"{repo.name} {gate[0]}: {(r.stdout + r.stderr)[-600:]}")
        finally:
            os.unlink(path)
        self.assertIsNone(M.commit_as_found(self.dir, 8))  # clean now: nothing to do

    def test_detached_head_is_refused(self):
        self.g("checkout", "-q", "--detach")
        (self.dir / ".ai" / "registry-map.json").write_text('{"x": 2}\n')
        self.assertIn("detached", M.commit_repo(self.dir, [], "conform: x").get("skipped", ""))


class ClaudeSeat(unittest.TestCase):
    def test_only_claude_seats_exist(self):
        self.assertEqual(list(M.PROVIDERS), ["claude"])

    def test_envelope_structured_output_is_the_answer(self):
        import json
        env = {"type": "result", "subtype": "success", "is_error": False, "num_turns": 9, "session_id": "s1",
               "result": "", "structured_output": {"subject": "x", "pairs": [], "declined": [], "notes": ""}}
        r = M.read_seat("claude", pathlib.Path("."), json.dumps(env))
        self.assertEqual(r["answer"]["subject"], "x")
        self.assertIsNone(r["read_nothing"])
        self.assertIsNone(r["error"])
        one = M.read_seat("claude", pathlib.Path("."), json.dumps({**env, "num_turns": 1}))
        self.assertIn("1 turn", one["read_nothing"])

    def test_seat_cannot_write(self):
        import tempfile
        d = pathlib.Path(tempfile.mkdtemp(prefix="curator-seat-"))
        (d / "p.md").write_text("judge", encoding="utf-8")
        (d / "s.json").write_text("{}", encoding="utf-8")
        argv, stdin, _ = M.seat_command("claude", "m", "high", d / "p.md", d / "s.json", d, "sid", str(d))
        self.assertEqual(stdin, "judge")
        self.assertIn("Edit", argv[argv.index("--disallowedTools") + 1])
        self.assertIn("--no-session-persistence", argv)


class Night(unittest.TestCase):
    def test_the_detached_child_runs_in_the_foreground(self):
        import argparse
        a = argparse.Namespace(providers="claude", timeout_min=35, per_provider=1, terminal_owns=True, repos=None,
                               review="claude", reviewer_model="sonnet", until="06:30", max_rounds=0)
        self.assertIn("--foreground", M.night_argv(a))

    def test_deadline_rolls_to_tomorrow(self):
        from datetime import datetime
        self.assertEqual(M._deadline("06:30", datetime(2026, 10, 12, 23, 0)).day, 13)
        self.assertEqual(M._deadline("23:30", datetime(2026, 10, 12, 23, 0)).day, 12)


class NightGuard(unittest.TestCase):
    TASK = {"Comment": "Curator night|23:00-07:00", "Scheduled Task State": "Enabled",
            "Next Run Time": "10/24/2026 11:00:00 PM"}

    def setUp(self):
        import tempfile
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self._dir, M.MULTI_DIR = M.MULTI_DIR, self.tmp

    def tearDown(self):
        M.MULTI_DIR = self._dir

    def test_the_window_wraps_midnight(self):
        from datetime import datetime
        self.assertTrue(M._in_window("23:00-07:00", datetime(2026, 10, 24, 2, 0)))
        self.assertTrue(M._in_window("23:00-07:00", datetime(2026, 10, 24, 23, 30)))
        self.assertFalse(M._in_window("23:00-07:00", datetime(2026, 10, 24, 7, 0)))
        self.assertTrue(M._in_window("01:00-06:30", datetime(2026, 10, 24, 3, 0)))

    def test_a_live_lock_says_no_loop_is_needed(self):
        import json, os
        (self.tmp / "night.lock").write_text(json.dumps(
            {"pid": os.getpid(), "create_time": M.L.proc_create_time(os.getpid()), "at": "now"}), encoding="utf-8")
        g = M.night_guard(self.TASK)
        self.assertTrue(g["running"])
        self.assertIn("no other loop is needed", g["say"])

    def test_a_dead_lock_inside_the_window_is_named(self):
        from datetime import datetime
        g = M.night_guard(self.TASK, datetime(2026, 10, 24, 2, 0))
        self.assertFalse(g["running"])
        self.assertTrue(g["in_window"])

    def test_a_disabled_task_is_not_a_schedule(self):
        g = M.night_guard({**self.TASK, "Scheduled Task State": "Disabled"})
        self.assertFalse(g["scheduled"])
        self.assertFalse(g["in_window"])


if __name__ == "__main__":
    unittest.main()
