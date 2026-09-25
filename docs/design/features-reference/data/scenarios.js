// Scenario declarations + one round's results, keyed by feature slug.
//
// A FIXTURE, and only a fixture: `features.js` was staged for the design
// contest before scenarios existed as a concept, so it carries none. This file
// adds them for the same two real projects so the Features page's scenario
// panel can be put beside the reference designs while the real store is empty.
// Nothing here is ever written to the database and the page says out loud that
// it is showing a fixture.
//
// Shape per row: { slug, title, axes, scope, source, floor|null,
//   latest: null | { run_id, state, score|null, confidence, n|null, proof,
//                    summary } }
// `floor_hit` and `advisory` are DERIVED by the same fold the product uses
// (S6/S7) and are deliberately absent here, exactly as they are absent from a
// member's real result file.
window.SCENARIOS = {
  "candidate-application-intake": [
    {
      "slug": "desktop-full-form",
      "title": "Desktop, full application form",
      "axes": { "surface": "desktop", "form": "full" },
      "scope": "must_hold",
      "source": "operator",
      "floor": 0.7,
      "latest": {
        "run_id": "fx-run-1",
        "state": "measured",
        "score": 0.86,
        "confidence": "high",
        "n": 40,
        "proof": "observed",
        "summary": "Completion holds across the whole knockout set."
      }
    },
    {
      "slug": "mobile-conversational",
      "title": "Mobile, conversational apply",
      "axes": { "surface": "mobile", "form": "conversational" },
      "scope": "must_hold",
      "source": "operator",
      "floor": 0.7,
      "latest": {
        "run_id": "fx-run-1",
        "state": "measured",
        "score": 0.54,
        "confidence": "med",
        "n": 12,
        "proof": "simulated",
        "summary": "Drop-off after the third knockout question; evidence is simulated, so this flags rather than fails."
      }
    },
    {
      "slug": "returning-candidate",
      "title": "Returning candidate, known email",
      "axes": { "candidate_family": "returning" },
      "scope": "tracked",
      "source": "council",
      "floor": null,
      "latest": {
        "run_id": "fx-run-1",
        "state": "measured",
        "score": 0.61,
        "confidence": "low",
        "n": 6,
        "proof": "replayed",
        "summary": "Prefill works; the duplicate check is the weak step."
      }
    },
    {
      "slug": "agency-submitted",
      "title": "Agency-submitted candidate",
      "axes": { "channel": "agency" },
      "scope": "tracked",
      "source": "operator",
      "floor": null,
      "latest": null
    },
    {
      "slug": "internal-transfer",
      "title": "Internal transfer applicant",
      "axes": { "candidate_family": "internal" },
      "scope": "out_of_scope",
      "source": "operator",
      "floor": null,
      "latest": null
    },
    {
      "slug": "accessibility-screen-reader",
      "title": "Screen-reader only",
      "axes": { "assistive": "screen-reader" },
      "scope": "proposed",
      "source": "council",
      "floor": null,
      "latest": null
    },
    {
      "slug": "low-bandwidth",
      "title": "Low bandwidth, intermittent connection",
      "axes": { "network": "degraded" },
      "scope": "proposed",
      "source": "council",
      "floor": null,
      "latest": null
    }
  ],
  "ai-candidate-screening": [
    {
      "slug": "it-candidates",
      "title": "IT candidates",
      "axes": { "candidate_family": "it" },
      "scope": "must_hold",
      "source": "operator",
      "floor": 0.7,
      "latest": {
        "run_id": "fx-run-2",
        "state": "measured",
        "score": 0.91,
        "confidence": "high",
        "n": 120,
        "proof": "observed",
        "summary": "Strongest family; skill extraction is near complete."
      }
    },
    {
      "slug": "marketing-candidates",
      "title": "Marketing candidates",
      "axes": { "candidate_family": "marketing" },
      "scope": "must_hold",
      "source": "incident",
      "floor": 0.7,
      "latest": {
        "run_id": "fx-run-2",
        "state": "measured",
        "score": 0.42,
        "confidence": "high",
        "n": 60,
        "proof": "observed",
        "summary": "Portfolio-led CVs score as thin; the rubric reads tools, not outcomes."
      }
    },
    {
      "slug": "trades-candidates",
      "title": "Trades and field roles",
      "axes": { "candidate_family": "trades" },
      "scope": "tracked",
      "source": "council",
      "floor": null,
      "latest": {
        "run_id": "fx-run-2",
        "state": "unmeasured",
        "score": null,
        "confidence": "low",
        "n": null,
        "proof": "claimed",
        "summary": "No sample reached the run."
      }
    },
    {
      "slug": "non-english-cv",
      "title": "Non-English CV",
      "axes": { "language": "non-en" },
      "scope": "tracked",
      "source": "operator",
      "floor": null,
      "latest": null
    },
    {
      "slug": "executive-search",
      "title": "Executive search",
      "axes": { "seniority": "exec" },
      "scope": "proposed",
      "source": "council",
      "floor": null,
      "latest": null
    }
  ],
  "developer-case-assessment": [
    {
      "slug": "backend-case",
      "title": "Backend case",
      "axes": { "track": "backend" },
      "scope": "must_hold",
      "source": "operator",
      "floor": 0.6,
      "latest": {
        "run_id": "fx-run-3",
        "state": "measured",
        "score": 0.88,
        "confidence": "high",
        "n": 30,
        "proof": "replayed",
        "summary": "Graders agree with the model on all but two submissions."
      }
    },
    {
      "slug": "frontend-case",
      "title": "Frontend case",
      "axes": { "track": "frontend" },
      "scope": "must_hold",
      "source": "operator",
      "floor": 0.6,
      "latest": {
        "run_id": "fx-run-3",
        "state": "measured",
        "score": 0.55,
        "confidence": "med",
        "n": 18,
        "proof": "simulated",
        "summary": "Visual craft is judged from a screenshot, which is not the artefact."
      }
    },
    {
      "slug": "data-case",
      "title": "Data case",
      "axes": { "track": "data" },
      "scope": "tracked",
      "source": "operator",
      "floor": null,
      "latest": null
    }
  ],
  "release-readiness-gate": [
    {
      "slug": "first-release",
      "title": "A repository's first release",
      "axes": { "history": "none" },
      "scope": "must_hold",
      "source": "operator",
      "floor": 0.7,
      "latest": {
        "run_id": "fx-run-4",
        "state": "measured",
        "score": 0.79,
        "confidence": "med",
        "n": 9,
        "proof": "observed",
        "summary": "Holds without prior runs to lean on."
      }
    },
    {
      "slug": "monorepo",
      "title": "Monorepo with many packages",
      "axes": { "layout": "monorepo" },
      "scope": "tracked",
      "source": "council",
      "floor": null,
      "latest": null
    }
  ]
};
