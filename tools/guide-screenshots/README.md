# Guide Screenshots

Automated capture of Personas desktop screens for the marketing-site user
guide (`personas-web/src/app/guide`). Each YAML recipe in `recipes/`
describes how to navigate to a topic-relevant screen; the runner drives the
running desktop app via its test-automation HTTP API and writes one PNG per
(topic × locale) into `personas-web/public/imgs/guide/topics/`.

## One-time setup

```bash
pip install httpx pyyaml
# or use uvx: uvx --with httpx --with pyyaml python tools/guide-screenshots/runner.py
```

## Running

```bash
# 1. Start the desktop app with test automation enabled
npm run tauri dev -- --features test-automation

# 2. In another terminal, run the full sweep (all recipes × all locales)
python tools/guide-screenshots/runner.py

# Subsets:
python tools/guide-screenshots/runner.py --topic creating-your-first-agent
python tools/guide-screenshots/runner.py --locales en,de,ja
python tools/guide-screenshots/runner.py --max-width 960
python tools/guide-screenshots/runner.py --dry-run
```

## Adding a recipe

1. Pick a topic id from `personas-web/src/data/guide/topics.ts`
2. Create `recipes/<topic-id>.yaml` — see existing recipes for the step
   vocabulary (`navigate`, `click_testid`, `fill_field`, `wait_for`,
   `wait`, `set_theme`)
3. Find the relevant `data-testid`s in `docs/guide-test-automation.md`
4. Register it on the topic in `topics.ts`:
   ```ts
   coverage: {
     screenshotRecipe: "tools/guide-screenshots/recipes/<topic-id>.yaml",
   }
   ```
5. Run the runner with `--topic <topic-id>` to verify it captures correctly

## Design decisions

- **Dark theme only** (`dark-midnight`) — light variants would double the
  asset count without meaningful value for the guide audience
- **Max width 1280** by default — images are downscaled before save to keep
  the marketing bundle light; retina sharpness is not required
- **One PNG per locale** — 14 languages, so a sweep produces up to
  14 × N files. Recipes can narrow `locales:` if a topic is English-only
- **Recipes drive the UI, not the capture** — the window is grabbed via
  `xcap` at the OS level, so React/Tauri rendering is exactly what the user
  sees, no headless/virtualised rendering involved
