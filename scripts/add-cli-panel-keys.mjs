#!/usr/bin/env node
// One-shot script: insert the new vault.cli_panel block into every locale
// file that has a vault.credential_forms section. Uses English placeholder
// text so the keys exist structurally; translation team replaces later.
//
// Run: node scripts/add-cli-panel-keys.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const i18nDir = path.resolve(__dirname, "..", "src", "i18n");

const BLOCK = `    cli_panel: {
      credential_name: "Credential Name",
      binary_label: "Binary",
      docs_link: "Docs",
      checking_install: "Checking installation...",
      error: "Error",
      retry: "Retry",
      not_installed_title: "Not installed",
      not_installed_desc: "{label} is not detected on this machine.",
      copy: "Copy",
      recheck: "Re-check",
      installed_title: "Installed",
      verify_auth: "Verify Auth",
      verifying_auth: "Verifying authentication...",
      not_authenticated_title: "Not authenticated",
      authenticated_title: "Authenticated",
      test_connection: "Test Connection",
      cancel: "Cancel",
      save_connection: "Save Connection",
      save_failed: "Failed to capture credential from CLI",
    },
`;

const LOCALES = ["ar", "bn", "de", "es", "fr", "hi", "id", "ja", "ko", "ru", "vi", "zh"];

let updated = 0;
for (const lang of LOCALES) {
  const file = path.join(i18nDir, `${lang}.ts`);
  if (!fs.existsSync(file)) continue;
  const raw = fs.readFileSync(file, "utf8");

  if (raw.includes("cli_panel:")) {
    console.log(`${lang}: already has cli_panel, skipping`);
    continue;
  }

  // Find credential_forms: { and walk the brace depth to find the closing },
  const anchor = raw.indexOf("credential_forms: {");
  if (anchor === -1) {
    console.log(`${lang}: no credential_forms section, skipping`);
    continue;
  }
  let depth = 0;
  let i = anchor;
  for (; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) {
    console.log(`${lang}: brace matching failed, skipping`);
    continue;
  }
  // Advance past the trailing `,` and newline
  let insertAt = i + 1;
  if (raw[insertAt] === ",") insertAt++;
  if (raw[insertAt] === "\n") insertAt++;

  const next = raw.slice(0, insertAt) + BLOCK + raw.slice(insertAt);
  fs.writeFileSync(file, next);
  console.log(`${lang}: inserted cli_panel block`);
  updated++;
}
console.log(`\nUpdated ${updated} locale file(s).`);
