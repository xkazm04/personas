/* Wire Product Scout's uc_scan_and_enrich to use the Gmail MCP bridge tools
 * (mcp__personas__gmail_list_messages / gmail_get_message) for its email-scan
 * step — reads the user's connected Gmail via the vault, no interactive auth.
 * Updates BOTH the source seed (_recipe_seeds.json, for the record / fresh
 * installs) AND the live recipe_definitions DB row (so re-adoption picks it up
 * with no rebuild — adoption hydrates recipes from the DB, not the embedded seed).
 * Run: node scripts/templates/__wire_gmail_scout.mjs */
import { readFileSync, writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';

const SEEDS = 'scripts/templates/_recipe_seeds.json';
const DB = 'C:/Users/mkdol/AppData/Roaming/com.personas.desktop/personas.db';
const GMAIL_NOTE =
  " EMAIL SCAN (when relevant): the user's Gmail is reachable directly via the MCP tools `mcp__personas__gmail_list_messages` (args: {query, max_results} — e.g. query 'newer_than:7d category:promotions OR from:noreply' for vendor/release mail) and `mcp__personas__gmail_get_message` (args: {message_id, format:'metadata'|'full'}) — these read the connected Gmail through the vault credential with NO interactive auth and NO API key. Use them to pull recent vendor newsletters / release emails as an ADDITIONAL opportunity source alongside web research. If gmail_list_messages reports no Gmail credential, skip email and rely on web research.";

const seeds = JSON.parse(readFileSync(SEEDS, 'utf8'));
const r = seeds.recipes.find((x) => x.source_template_id === 'product-scout' && x.source_use_case_id === 'uc_scan_and_enrich');
if (!r) throw new Error('product-scout/uc_scan_and_enrich recipe not found');
const uc = JSON.parse(r.prompt_template);

if (!uc.description.includes('gmail_list_messages')) uc.description += GMAIL_NOTE;
uc.tool_hints = Array.from(new Set([...(uc.tool_hints || []), 'mcp__personas__gmail_list_messages', 'mcp__personas__gmail_get_message']));
// name the bridge tools on the email-scan flow node
if (uc.use_case_flow && Array.isArray(uc.use_case_flow.nodes)) {
  const n = uc.use_case_flow.nodes.find((x) => /scan email|email senders/i.test(x.label || ''));
  if (n) n.label = 'Scan Gmail via mcp__personas__gmail_list_messages (if connected)';
}

const newPrompt = JSON.stringify(uc);
r.prompt_template = newPrompt;
writeFileSync(SEEDS, JSON.stringify(seeds, null, 2));
console.log('seed updated: product-scout/uc_scan_and_enrich (gmail bridge tools)');

// live DB row update so re-adoption uses it without a rebuild
const db = new Database(DB);
const info = db
  .prepare("UPDATE recipe_definitions SET prompt_template = ?, updated_at = datetime('now') WHERE source_template_id = 'product-scout' AND source_use_case_id = 'uc_scan_and_enrich'")
  .run(newPrompt);
console.log('DB recipe_definitions rows updated:', info.changes);
db.close();
