#!/usr/bin/env node
/**
 * The tier gate.
 *
 * WHAT THIS USED TO BE, and why it changed (2026-09-20). It ran the prebuild
 * codegen and then THREE serial `npx vite build`s with `VITE_APP_TIER` set to
 * starter / team / builder, and asserted the **exit code** of each. The repo's
 * own audit — `docs/concepts/golden-paths/tier-and-capability-gating.md` §7
 * items 4-5 — records what that bought: it "never reads the output, never diffs
 * the bundles, and never verifies the variable reached Vite at all", and all
 * three builds wrote to the same `dist/`, so it could not compare them even in
 * principle. The tiers differ by ONE `import.meta.env` read; there is no
 * per-tier `define` and no tree-shaking. Compilation was the single property
 * that was never in doubt, and it was the only one being checked.
 *
 * WHAT IT IS NOW:
 *   1. codegen (unchanged — a direct `vite build` bypasses the prebuild hook);
 *   2. the TIER MATRIX test (`src/lib/navigation/tierMatrix.test.ts`), which
 *      asserts the gating LOGIC: the exact surface set each tier shows, that the
 *      sets nest, that no gate names a surface that no longer exists, that
 *      nothing differs between tiers for an UNDECLARED reason, and that the
 *      resolver really reads `import.meta.env.VITE_APP_TIER`;
 *   3. ONE `vite build`, whose OUTPUT IS THEN READ — `dist/index.html` must
 *      exist, must reference an entry chunk that is actually on disk, and the
 *      build must have emitted a plausible number of chunks.
 *
 * Measured on this host at adoption: the three-build form 40.8 s
 * (`fe-check-tiers` baseline in docs/development/build-ledger.jsonl). One build
 * plus the matrix test is roughly one third of that. (The 216-398 s figure that
 * travels in docs/architecture/warm-verification-service.md and
 * adding-a-ci-gate.md predates Vite 8 / rolldown and no longer reproduces.)
 *
 * WHAT IT STILL DOES NOT PROVE: that Vite's build-time substitution delivers
 * `VITE_APP_TIER` into `uiModes.ts`. The matrix test proves the module reads the
 * variable; proving the bundler writes it needs the probe build registered as
 * fix 3 in that golden path's §9, which would restore a second build. Stated
 * rather than implied.
 *
 * WHAT IT LEAVES IN dist/: the DEFAULT-tier bundle (no `VITE_APP_TIER`, which is
 * exactly what release.yml ships) and NO sourcemaps (vite emits them only under
 * `PERSONAS_RELEASE=1`). `scripts/check-bundle-budget.mjs` reads `dist/assets`
 * and its baseline is recorded from a default-tier build, so this is the tree it
 * wants. In `--all-tiers` mode the LAST tier named wins the directory, as before.
 *
 * Usage:
 *   node scripts/check-tiers.mjs                 # matrix + ONE default-tier build
 *   node scripts/check-tiers.mjs --all-tiers     # matrix + starter, team, builder
 *   node scripts/check-tiers.mjs starter team    # matrix + the named tiers (back-compat)
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MATRIX_TEST = "src/lib/navigation/tierMatrix.test.ts";

/**
 * Floor for emitted JS chunks, not an equality. It answers ONE question — did
 * the build emit a bundle, or did it exit 0 over an almost-empty directory —
 * and nothing else; the real size ratchet is `scripts/check-bundle-budget.mjs`.
 * Measured 2026-09-20: 1,515 chunks. A floor an order of magnitude below that is
 * unreachable by anything except a broken build.
 */
const MIN_CHUNKS = 200;

const argv = process.argv.slice(2);
const allTiers = argv.includes("--all-tiers");
const namedTiers = argv.filter((a) => !a.startsWith("--"));
const TIERS = allTiers ? ["starter", "team", "builder"] : namedTiers;

/**
 * `shell` is opt-in per call, NOT a blanket `process.platform === "win32"`.
 * Under a Windows shell, `process.execPath` ("C:\Program Files\nodejs\node.exe")
 * is split on the space and the spawn dies with `'C:\Program' is not
 * recognized` — while `npx` needs the shell to resolve at all.
 */
function run(cmd, args, { env, shell = false } = {}) {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      cwd: repoRoot,
      shell,
      env: { ...process.env, ...env },
    });
    child.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${cmd} ${args.join(" ")} exited ${code}`))));
    child.on("error", rej);
  });
}

// Codegen (i18n split, command names, ts-rs bindings, sprites, …) is wired into
// the predev/prebuild npm hooks, and vite's buildStart codegen was deliberately
// removed (see vite.config.ts). The build below spawns `vite build` DIRECTLY —
// bypassing prebuild — so codegen has to run here or the build compiles against
// stale generated files.
const npxShell = process.platform === "win32";
const codegen = () => run(process.execPath, [join(repoRoot, "scripts", "run-codegen.mjs"), "prebuild"]);
const viteBuild = (tier) => run("npx", ["vite", "build"], { env: tier ? { VITE_APP_TIER: tier } : {}, shell: npxShell });
const matrix = () => run("npx", ["vitest", "run", MATRIX_TEST], { shell: npxShell });

/**
 * Read what the build produced. The old gate's defining weakness was that it
 * asserted an exit code and stopped; a build that exits 0 having emitted
 * nothing useful must not read as a pass.
 */
function assertBundleEmitted() {
  const dist = join(repoRoot, "dist");
  const indexHtml = join(dist, "index.html");
  if (!existsSync(indexHtml)) throw new Error("no dist/index.html — the build emitted no entry document");
  const html = readFileSync(indexHtml, "utf8");
  if (html.length < 200) throw new Error(`dist/index.html is ${html.length} bytes — that is not an app shell`);

  // Follow at least one script reference from the HTML to a file on disk. A
  // dangling entry reference is the shape of a half-written dist, and it is
  // invisible to both an exit code and a file count.
  const refs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  const resolved = refs.filter((r) => {
    const p = join(dist, r.replace(/^\.?\//, ""));
    return existsSync(p) && statSync(p).size > 0;
  });
  if (resolved.length === 0) {
    throw new Error(`dist/index.html references ${refs.length} script(s), none of which exist on disk: ${refs.join(", ")}`);
  }

  const assets = join(dist, "assets");
  if (!existsSync(assets)) throw new Error("no dist/assets — the build emitted no chunks");
  const chunks = readdirSync(assets).filter((f) => f.endsWith(".js"));
  // Refuse an EMPTY enumeration before the floor check. "Found nothing" and
  // "looked at nothing" are different outcomes; only one of them is a build.
  if (chunks.length === 0) {
    process.stderr.write("check:tiers: dist/assets holds no JS at all — nothing was built.\n");
    process.exit(1);
  }
  if (chunks.length < MIN_CHUNKS) {
    throw new Error(`dist/assets holds ${chunks.length} JS chunks, below the floor of ${MIN_CHUNKS} — the build emitted almost nothing`);
  }
  return { chunks: chunks.length, entry: `${resolved.length}/${refs.length} script refs resolved (${resolved.join(", ")})` };
}

async function main() {
  if (!existsSync(join(repoRoot, MATRIX_TEST))) {
    // The matrix is now the substance of this gate. If the file is gone, the
    // gate must fail rather than quietly degrade back into "three builds compiled".
    throw new Error(`${MATRIX_TEST} is missing — the tier gate has no logic check left to run`);
  }

  await codegen();

  process.stdout.write("\n=== tier matrix ===\n");
  await matrix();

  let failed = 0;
  if (TIERS.length === 0) {
    process.stdout.write("\n=== vite build (default tier — what release ships) ===\n");
    await viteBuild(null);
  } else {
    for (const tier of TIERS) {
      process.stdout.write(`\n=== VITE_APP_TIER=${tier} ===\n`);
      try {
        await viteBuild(tier);
      } catch (e) {
        failed += 1;
        process.stderr.write(`${e.message}\n`);
        // Keep going so a single broken tier doesn't hide breakage in the others.
      }
    }
    if (failed > 0) {
      process.stderr.write(`\n${failed}/${TIERS.length} tier builds failed\n`);
      process.exit(1);
    }
  }

  const { chunks, entry } = assertBundleEmitted();
  const built = TIERS.length === 0 ? "default tier" : `${TIERS.length} tier(s): ${TIERS.join(", ")}`;
  const leftBehind = TIERS.length === 0 ? "default tier" : TIERS[TIERS.length - 1];
  process.stdout.write(
    `\ntiers OK — matrix green, ${built} built, dist/ read: ${chunks} JS chunks, ${entry}.\n` +
      `dist/ now holds the ${leftBehind} bundle (no sourcemaps unless PERSONAS_RELEASE=1).\n`,
  );
}

main().catch((e) => {
  process.stderr.write(`check:tiers failed: ${e.message}\n`);
  process.exit(1);
});
