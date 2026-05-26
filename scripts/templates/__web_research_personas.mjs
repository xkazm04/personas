/* F: make Product Scout + Idea Harvester deliver value via web research grounded
 * in the bound codebase's stack, WITHOUT requiring Gmail/messaging. Email/messaging
 * become optional enrichment; web research (+ codebase grounding) is always-on so
 * an autonomous run never precondition-fails for a missing inbox.
 * Run: node scripts/templates/__web_research_personas.mjs */
import { readFileSync, writeFileSync } from 'node:fs';
const SEEDS = 'scripts/templates/_recipe_seeds.json';
const PS = 'scripts/templates/research/product-scout.json';
const IH = 'scripts/templates/productivity/idea-harvester.json';

const seeds = JSON.parse(readFileSync(SEEDS, 'utf8'));
const editRecipe = (tpl, ucId, fn) => {
  const r = seeds.recipes.find((x) => x.source_template_id === tpl && x.source_use_case_id === ucId);
  if (!r) throw new Error(`recipe ${tpl}/${ucId} not found`);
  const uc = JSON.parse(r.prompt_template);
  fn(uc, r);
  r.prompt_template = JSON.stringify(uc);
};

// ── Product Scout: uc_scan_and_enrich → web-first opportunity scan ──
editRecipe('product-scout', 'uc_scan_and_enrich', (uc, r) => {
  uc.title = 'Scan & Enrich Implementation Opportunities';
  uc.description = "Scheduled scan for real implementation opportunities (new connectors/integrations, API & SDK version updates, notable tooling) relevant to the bound codebase's tech stack. PRIMARY source is web research: read the codebase to learn the stack (package.json / Cargo.toml / imports), then search GitHub releases, project changelogs, release notes, and the web for relevant updates. If an email connector is also connected, additionally scan configured senders' newsletters/release emails. Enriches each candidate, classifies into new_connector / api_version / tooling, dedups against memory, and produces candidates for human triage. Always delivers from web research even with no inbox.";
  uc.capability_summary = 'Codebase-grounded web scan (GitHub releases, changelogs, web) for implementation opportunities; optional email enrichment. Produces triage candidates.';
  uc.connectors = []; // nothing hard-required — codebase + email are optional, web is always available
  uc.error_handling = "Email connector absent/unauthenticated → SKIP email and deliver from web research alone (this is NOT a failure — never report precondition_failed just because email isn't connected). Codebase absent → research opportunities for the stack hinted in input focus_topics, or general high-signal dev tooling. Dead URL → single web_search fallback, skip if still empty. Per-candidate exceptions → log and continue. Only precondition_failed if BOTH web_search/http_request are unavailable AND no codebase — i.e. genuinely no way to research.";
  uc.input_schema = [
    { name: 'target_codebase', type: 'connector_ref', ui_component: 'CodebaseSelector', connector: 'codebase', required: false, description: 'Optional. The codebase whose tech stack scopes the opportunity search (so results are relevant to what you actually build). If unset, falls back to focus_topics.' },
    { name: 'focus_topics', type: 'text', required: false, description: 'Comma-separated topics/stack to scope the search when no codebase is bound (e.g. "Next.js, Stripe, SQLite, OAuth"). Used as the search seed.' },
    { name: 'enrichment_depth', type: 'enum', options: ['shallow', 'medium', 'deep'], default: 'medium', description: 'Shallow = fetch the linked page only. Medium = + check GitHub repo stars/activity. Deep = + check for an existing Personas connector for the service + community reviews.' },
    { name: 'senders', type: 'text', required: false, description: 'Optional. Comma-separated email sender allowlist — only used if an email connector is connected.' },
  ];
  uc.sample_input = { target_codebase: '{{param.aq_target_codebase}}', focus_topics: '{{param.aq_focus_topics}}', enrichment_depth: '{{param.aq_enrichment_depth}}', senders: '{{param.aq_senders}}' };
  uc.tool_hints = ['web_search', 'http_request', 'search_code', 'file_read', 'file_write'];
  uc.use_case_flow = { nodes: [
    { id: 's1', type: 'start', label: 'Scheduled tick' },
    { id: 's2', type: 'connector', label: 'Read codebase to learn the stack (or use focus_topics)', connector: 'codebase' },
    { id: 's3', type: 'action', label: 'Web search: GitHub releases / changelogs / updates for that stack' },
    { id: 's4', type: 'connector', label: 'Optionally scan email senders (if connected)', connector: 'email' },
    { id: 's5', type: 'action', label: 'Dedup against seen-URL memory' },
    { id: 's6', type: 'action', label: 'Enrich + classify (new_connector / api_version / tooling) + relevance' },
    { id: 's7', type: 'event', label: 'Emit scout.opportunity.discovered per candidate' },
    { id: 's8', type: 'end', label: 'Candidates ready for triage' },
  ], edges: [
    { source: 's1', target: 's2' }, { source: 's2', target: 's3' }, { source: 's3', target: 's4' },
    { source: 's4', target: 's5' }, { source: 's5', target: 's6' }, { source: 's6', target: 's7' }, { source: 's7', target: 's8' },
  ] };
});

// ── Idea Harvester: uc_harvest → web + codebase-grounded idea harvesting ──
editRecipe('idea-harvester', 'uc_harvest', (uc) => {
  uc.description = "Scheduled extraction of concrete idea candidates. PRIMARY source is web research grounded in the bound codebase's domain/stack: read the codebase (if connected) to understand the product, then mine the web — trending GitHub repos, Hacker News, relevant communities, competitor changelogs — for feature/improvement ideas that fit. If messaging / knowledge-base connectors are also connected, additionally extract ideas from those. Holds each candidate for human triage. Always delivers from web + codebase even with no messaging/KB source connected.";
  uc.capability_summary = 'Codebase/domain-grounded web idea harvesting (trending repos, HN, communities); optional messaging/KB sources. Produces triage candidates.';
  uc.connectors = []; // all sources optional — web is always available
  uc.error_handling = "Messaging / knowledge-base connectors absent → SKIP them and harvest from web + codebase alone (NOT a failure — never precondition_failed for a missing chat/KB source). Codebase absent → harvest general high-signal product ideas seeded by focus/domain input. Only precondition_failed if web research is genuinely unavailable AND no codebase. Per-source exceptions → log and continue.";
  uc.tool_hints = ['web_search', 'http_request', 'search_code', 'file_read', 'file_write'];
  if (uc.use_case_flow && Array.isArray(uc.use_case_flow.nodes)) {
    uc.use_case_flow.nodes.unshift({ id: 'h0', type: 'action', label: 'Read codebase domain/stack (or focus input) → seed web research' });
  }
});

writeFileSync(SEEDS, JSON.stringify(seeds, null, 2));
console.log('recipes updated: product-scout/uc_scan_and_enrich (web-first), idea-harvester/uc_harvest (web+codebase)');

// ── Product Scout template: email optional, add codebase picker, retune goal ──
const ps = JSON.parse(readFileSync(PS, 'utf8'));
const pp = ps.payload;
const email = (pp.persona.connectors || []).find((c) => c.name === 'email');
if (email) { email.required = false; email.fallback_note = 'Without an email connector, Product Scout finds implementation opportunities from web research (GitHub releases, changelogs, the web) grounded in your codebase — the inbox is an optional extra source.'; }
if (!(pp.persona.connectors || []).some((c) => c.name === 'codebase')) {
  pp.persona.connectors.push({ name: 'codebase', label: 'Codebase', auth_type: 'local', role: 'code_analysis', category: 'development', required: false, fallback_note: 'Without a codebase, Product Scout scopes its search from the focus_topics you provide instead of your real stack.', credential_fields: [{ key: 'codebase_root', label: 'Codebase root path', type: 'text', placeholder: '/path/to/your/codebase', helpText: 'Optional. Lets Product Scout scope opportunities to your actual tech stack.', required: false }] });
}
pp.persona.tools = Array.from(new Set([...(pp.persona.tools || []), 'web_search', 'http_request', 'file_read', 'file_write']));
pp.persona.goal = "Surface real implementation opportunities — new connectors, API/SDK updates, and notable tooling relevant to your codebase's stack — by scanning the web (GitHub releases, changelogs) and, if connected, your inbox. Nothing vague, nothing duplicated, nothing you didn't ask to see.";
ps.description = "Autonomous scout that finds real implementation opportunities (new integrations, API/version updates, tooling) for your codebase's stack via web research — GitHub releases, changelogs, the web — and optionally your newsletter inbox. Produces a deduplicated triage queue, not noise. Works fully autonomously without an email connector.";
// adoption questions: add codebase picker + focus_topics; make email-related ones optional
const psq = pp.adoption_questions;
const mkOpt = (id) => { const q = psq.find((x) => x.id === id); if (q) q.optional = true; };
mkOpt('aq_senders'); mkOpt('aq_email_provider');
if (!psq.some((q) => q.id === 'aq_target_codebase')) {
  psq.unshift({ id: 'aq_target_codebase', scope: 'connector', connector_names: ['codebase'], use_case_id: 'uc_scan_and_enrich', use_case_ids: ['uc_scan_and_enrich'], category: 'configuration', question: 'Which codebase should scope the opportunity search (so results match your stack)?', type: 'select', optional: true, allow_custom: true, default: 'codebase', maps_to: 'use_cases[uc_scan_and_enrich].sample_input.target_codebase', variable_name: 'target_codebase', context: 'Optional. Pick a registered Codebase so Product Scout scopes its web search to your real tech stack. If unset, it uses the focus topics below.', dimension: 'connector', dynamic_source: { service_type: 'development', operation: 'list_credentials', source: 'vault' } });
}
if (!psq.some((q) => q.id === 'aq_focus_topics')) {
  psq.push({ id: 'aq_focus_topics', scope: 'capability', use_case_id: 'uc_scan_and_enrich', use_case_ids: ['uc_scan_and_enrich'], category: 'domain', question: 'What stack / topics should the search focus on (used when no codebase is bound)?', type: 'text', optional: true, default: '', maps_to: 'use_cases[uc_scan_and_enrich].sample_input.focus_topics', variable_name: 'focus_topics', context: 'Optional. e.g. "Next.js, Stripe, SQLite, OAuth". Seeds the opportunity search when no codebase connector is selected.', dimension: 'task' });
}
ps.service_flow = ['Codebase', 'Web', 'Messages']; pp.service_flow = ['Codebase', 'Web', 'Messages'];
writeFileSync(PS, JSON.stringify(ps, null, 2));
console.log('product-scout.json: email optional, codebase picker + focus_topics added, goal retuned');

// ── Idea Harvester template: retune goal so web research is the default source ──
const ih = JSON.parse(readFileSync(IH, 'utf8'));
const ip = ih.payload;
ip.persona.tools = Array.from(new Set([...(ip.persona.tools || []), 'web_search', 'http_request', 'file_read', 'file_write']));
ip.persona.goal = "Never lose a good idea — mine the web (trending repos, communities, competitor changelogs) grounded in your codebase's domain, plus any team chat / knowledge base you connect, hold each for human triage, and ground accepted ones in codebase reality before they hit the backlog.";
ih.description = "Autonomous idea harvester that mines the web — trending repos, Hacker News, communities, competitor changelogs — grounded in your codebase's domain, plus optional team chat / knowledge-base sources, for concrete feature ideas. Holds each for triage and grounds accepted ideas in codebase feasibility. Works without any messaging connector.";
writeFileSync(IH, JSON.stringify(ih, null, 2));
console.log('idea-harvester.json: goal/description retuned for web-first harvesting');
