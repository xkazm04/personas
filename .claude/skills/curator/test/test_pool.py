"""Unit tests for the /curator pool: worker sizing, liveness, limit detection, judging.

Run:  python -m unittest discover -s .claude/skills/curator/test -v
Pure functions only - nothing here opens the Personas database or spawns a worker.
"""

from __future__ import annotations

import importlib.util
import os
import pathlib
import shutil
import subprocess
import sys
import time
import unittest

HERE = pathlib.Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("curator_loop", HERE.parent / "loop.py")
loop = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(loop)


class WorkersAllowed(unittest.TestCase):
    """N = min(max, floor((free - reserve) / per_worker)), never negative."""

    def test_the_formula_at_its_named_constants(self):
        self.assertEqual(loop.RESERVE_GB, 6.0)
        self.assertEqual(loop.PER_WORKER_GB, 2.5)
        cases = [
            (5.0, 0),     # below the reserve: nothing, not a negative count
            (6.0, 0),     # exactly the reserve
            (8.4, 0),     # one worker needs 8.5
            (8.5, 1),
            (12.0, 2),    # floor(6 / 2.5) = 2
            (13.5, 3),
            (26.6, 4),    # this machine on 2026-10-09: memory allows 8, the ceiling says 4
        ]
        for free, want in cases:
            with self.subTest(free=free):
                self.assertEqual(loop.workers_allowed(free, max_workers=4), want)

    def test_the_ceiling_binds_before_memory(self):
        self.assertEqual(loop.workers_allowed(60.0, max_workers=2), 2)
        self.assertEqual(loop.workers_allowed(60.0, max_workers=0), 0)

    def test_unknown_memory_allows_exactly_one(self):
        # Unknown is not plenty, and refusing every claim on a missing reading stops her for nothing.
        self.assertEqual(loop.workers_allowed(None, max_workers=4), 1)
        self.assertEqual(loop.workers_allowed(float("nan"), max_workers=4), 1)
        self.assertEqual(loop.workers_allowed(None, max_workers=0), 0)

    def test_sampling_takes_the_median_so_one_spike_does_not_decide(self):
        readings = iter([30, 2, 29, 31, 28])  # GB; one collapse in the middle
        free = loop.sample_free_gb(read=lambda: next(readings) * 2 ** 30, sleep=lambda s: None)
        self.assertEqual(free, 29)

    def test_unreadable_memory_samples_to_none(self):
        self.assertIsNone(loop.sample_free_gb(read=lambda: None, sleep=lambda s: None))

    def test_the_fake_override(self):
        os.environ["CURATOR_FAKE_FREE_GB"] = "11"
        try:
            self.assertEqual(loop.sample_free_gb(read=lambda: 1 / 0), 11.0)
        finally:
            del os.environ["CURATOR_FAKE_FREE_GB"]


class Slots(unittest.TestCase):
    def test_only_a_conform_worker_in_this_repo_is_parallel(self):
        here = str(loop.PERSONAS_ROOT)
        self.assertEqual(loop.slot_of({"skill": "conform", "cwd": here}), "parallel")
        self.assertEqual(loop.slot_of({"skill": "conform", "cwd": r"C:\elsewhere\ai-registry"}), "serial")
        for skill in ("deepen", "intake", "reconcile", "harvest", None):
            self.assertEqual(loop.slot_of({"skill": skill, "cwd": here}), "serial")

    def test_a_busy_serial_slot_leaves_only_conform_plan_items(self):
        lanes, engines = loop.admission_filters({"queue", "plan", "method"}, {"conform", "deepen"}, True)
        self.assertEqual((lanes, engines), ({"plan"}, {"conform"}))
        lanes, engines = loop.admission_filters({"queue"}, {"deepen"}, True)
        self.assertEqual((lanes, engines), (set(), set()))
        self.assertEqual(loop.admission_filters({"plan"}, {"deepen"}, False), ({"plan"}, {"deepen"}))


class Liveness(unittest.TestCase):
    @unittest.skipIf(loop.psutil is None, "psutil not installed")
    def test_a_reused_pid_is_not_our_worker(self):
        me = os.getpid()
        born = loop.proc_create_time(me)
        self.assertTrue(loop.proc_alive(me, born))
        self.assertFalse(loop.proc_alive(me, born - 3600), "same pid, different birth: a reused pid")
        self.assertFalse(loop.proc_alive(None))

    @unittest.skipIf(loop.psutil is None, "psutil not installed")
    def test_a_dead_pid_is_dead(self):
        p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        born = loop.proc_create_time(p.pid)
        self.assertTrue(loop.proc_alive(p.pid, born), "positive control: alive while it runs")
        p.kill()
        p.wait()
        self.assertFalse(loop.proc_alive(p.pid, born))
        self.assertFalse(loop.proc_alive(2 ** 30, None))

    @unittest.skipIf(loop.psutil is None or not shutil.which("node"), "needs psutil and node")
    def test_the_command_line_scan_finds_a_planted_worker(self):
        # Positive control: a scan that cannot find a planted process has no standing
        # to report that a worker is gone.
        needle = "curator-test-needle-7f3a91"
        p = subprocess.Popen([shutil.which("node"), "-e", "setTimeout(() => {}, 20000)", needle])
        try:
            deadline = time.time() + 10
            hits = []
            while time.time() < deadline and not hits:
                hits = loop.live_workers_matching([needle])
                time.sleep(0.2)
            self.assertTrue(any(h["pid"] == p.pid for h in hits))
            self.assertEqual(loop.live_workers_matching(["short"]), [], "needles under six characters identify nothing")
        finally:
            p.kill()
            p.wait()
        self.assertFalse(any(h["pid"] == p.pid for h in loop.live_workers_matching([needle])))


class UsageLimit(unittest.TestCase):
    def test_a_banner_is_a_limit(self):
        self.assertTrue(loop.usage_limited("", "Claude AI usage limit reached|1760000000", 1))
        self.assertTrue(loop.usage_limited("5-hour limit reached - resets 2am", "", 1))
        self.assertTrue(loop.usage_limited("You've hit your limit", "", 0))

    def test_a_finished_report_that_mentions_a_limit_is_a_report(self):
        # The live case: the first subject in her plan on 2026-10-09 was usage-limit-governance.
        report = ("Judged 5 pairs of usage-limit-governance. " * 60
                  + "The usage limit ledger at src/lib/x.ts:4 resets per window; limit resets are logged.")
        self.assertGreater(len(report), loop.LIMIT_MAX_STDOUT)
        self.assertFalse(loop.usage_limited(report, "", 0))

    def test_silence_is_not_a_limit(self):
        self.assertFalse(loop.usage_limited("", "", 0))
        self.assertFalse(loop.usage_limited("done", "", 1))


class JudgeConform(unittest.TestCase):
    RUN = "abc.json"

    def judge(self, merge, **kw):
        base = dict(limited=False, timed_out=False, exit_code=0, out_tail="tail", tmp_left=False, timeout_min=45)
        base.update(kw)
        return loop.judge_conform(merge, self.RUN, **base)

    def merged(self, **f):
        file = {"file": self.RUN, "status": "merged", "pairs": 3, "merged": 0, "unchanged": 0,
                "older": 0, "declined": 0, "skipped": 0}
        file.update(f)
        return {"ok": True, "states": {"deviation": 2}, "files": [file],
                "skipped": [f"{self.RUN}: rate-limiting @ X: anchor src/a.ts:9 is a blank line", "other.json: no"],
                "declined": [f"{self.RUN}: retry @ Y: returned unknown"]}

    def test_landed_only_when_the_merger_accepted_verdicts(self):
        action, evidence = self.judge(self.merged(merged=2, skipped=1))
        self.assertEqual(action, "landed")
        self.assertIn("2 merged", evidence)
        self.assertIn("merged/abc.json", evidence)

    def test_every_verdict_refused_is_declined_with_the_reasons(self):
        action, evidence = self.judge(self.merged(skipped=3))
        self.assertEqual(action, "declined")
        self.assertIn("blank line", evidence)
        self.assertNotIn("other.json", evidence, "another file's refusals are not this worker's evidence")

    def test_a_run_file_judging_nothing_is_idled(self):
        self.assertEqual(self.judge(self.merged(pairs=0))[0], "idled")

    def test_a_held_lock_defers_the_settle_rather_than_guessing(self):
        action, _ = self.judge({"ok": False, "contended": True, "holder": {"pid": 1, "at": "x"}})
        self.assertEqual(action, "retry-merge")

    def test_no_run_file(self):
        self.assertEqual(self.judge(None, limited=True)[0], "release")
        self.assertEqual(self.judge(None, tmp_left=True)[0], "blocked")
        self.assertIn("timed out", self.judge(None, timed_out=True)[1])
        self.assertEqual(self.judge(None, exit_code=1)[0], "blocked")

    def test_a_run_file_beats_the_limit(self):
        # It wrote its verdicts and THEN hit the limit: the work landed.
        self.assertEqual(self.judge(self.merged(merged=1), limited=True)[0], "landed")

    def test_a_broken_run_file_is_blocked(self):
        self.assertEqual(self.judge(self.merged(status="incomplete"))[0], "blocked")


class JudgeSerial(unittest.TestCase):
    def judge(self, **kw):
        base = dict(commits=0, limited=False, timed_out=False, exit_code=0, out_tail="t", timeout_min=45)
        base.update(kw)
        return loop.judge_serial({"head": "abc1234"}, **base)

    def test_commits_land_and_say_the_range_is_shared(self):
        action, evidence = self.judge(commits=2)
        self.assertEqual(action, "landed")
        self.assertIn("sibling", evidence)

    def test_the_rest(self):
        self.assertEqual(self.judge()[0], "idled")
        self.assertEqual(self.judge(limited=True)[0], "release")
        self.assertEqual(self.judge(limited=True, commits=1)[0], "landed")
        self.assertEqual(self.judge(exit_code=2)[0], "blocked")
        self.assertEqual(self.judge(timed_out=True, commits=1)[0], "blocked")

    def test_a_request_has_its_own_vocabulary(self):
        for action, state in loop.REQUEST_STATE.items():
            self.assertIn(state, loop.TERMINAL_REQUEST, action)


class Brief(unittest.TestCase):
    def test_a_conform_worker_is_told_its_own_run_file_and_never_the_map(self):
        claim = {"lane": "plan", "lane_sentence": "x", "skill": "conform", "argument": "--subject settings",
                 "dispatch_id": "1234-dispatch", "session_id": "cli:9", "subject": "software-engineering/settings"}
        brief = loop.compose(claim)
        self.assertTrue(brief.startswith("/conform --subject settings"))
        self.assertIn(".ai/conform-runs/1234-dispatch.json", brief)
        self.assertIn("do NOT edit `.ai/registry-map.json`", brief)
        self.assertNotIn("STANDING AUTHORIZATION", brief, "the registry's push grant never reaches this repo")


if __name__ == "__main__":
    unittest.main()
