/* C + D one-off.
 * D: wire cross-persona LISTEN subscriptions on Dev Clone so emitted events get
 *    consumers (fixes "no subscriber matches"):
 *      - uc_triage      + listen qa.bug.found          (QA Guardian's confirmed bugs → triage)
 *      - uc_implementation + listen review_decision.approved (human approval drives implementation)
 * C: Visual Brand — capture a pasted design.md verbatim as an adoption input:
 *      - recipe uc_brief_generation: + brief_content input + verbatim-use logic
 *      - template: + aq_brief_content textarea question
 * Run: node scripts/templates/__wire_cd.mjs */
import { readFileSync, writeFileSync } from 'node:fs';
const SEEDS = 'scripts/templates/_recipe_seeds.json';
const VB = 'scripts/templates/marketing/visual-brand-asset-factory.json';

const seeds = JSON.parse(readFileSync(SEEDS, 'utf8'));
const editRecipe = (tpl, ucId, fn) => {
  const r = seeds.recipes.find((x) => x.source_template_id === tpl && x.source_use_case_id === ucId);
  if (!r) throw new Error(`recipe not found: ${tpl}/${ucId}`);
  const uc = JSON.parse(r.prompt_template);
  fn(uc);
  r.prompt_template = JSON.stringify(uc);
  return uc;
};
const addListen = (uc, eventType, desc) => {
  uc.event_subscriptions = uc.event_subscriptions || [];
  if (uc.event_subscriptions.some((e) => e.direction === 'listen' && e.event_type === eventType)) return;
  uc.event_subscriptions.push({ event_type: eventType, direction: 'listen', source_filter: '*', description: desc });
};

// ---- D: Dev Clone listen subscriptions ----
editRecipe('dev-clone', 'uc_triage', (uc) => {
  addListen(uc, 'qa.bug.found', "QA Guardian filed a confirmed bug — triage it into the backlog like any other candidate (dedupe against existing backlog, set priority from severity).");
});
editRecipe('dev-clone', 'uc_implementation', (uc) => {
  addListen(uc, 'review_decision.approved', "A human approved a pending review for this persona (e.g. an approved backlog item or proposed change) — proceed with implementation of the approved item.");
});

// ---- C: Visual Brand recipe — consume a pasted design.md verbatim ----
editRecipe('visual-brand-asset-factory', 'uc_brief_generation', (uc) => {
  uc.input_schema = uc.input_schema || [];
  if (!uc.input_schema.some((i) => i.name === 'brief_content')) {
    uc.input_schema.push({
      name: 'brief_content', type: 'text', ui_component: 'TextArea', required: false,
      description: "The user's own design.md / brand brief pasted verbatim (from Stitch, Figma, Gemini, or hand-written). Used as-is when brief_mode is 'I'll paste my own design.md'; ignored otherwise.",
    });
  }
  uc.sample_input = uc.sample_input || {};
  uc.sample_input.brief_content = '{{param.aq_brief_content}}';
  uc.description = (uc.description || '') + " When brief_mode is user-pasted AND brief_content is provided, use brief_content VERBATIM as design.md (do not re-extract from a codebase or source) — normalize it into the five-section structure only if sections are missing, otherwise store it unchanged at design_context.design_files['design.md']. Only auto-extract from the source/codebase when brief_mode is auto-extract.";
  // record the precedence in tool_hints-adjacent flow note if a flow exists
  if (uc.use_case_flow && Array.isArray(uc.use_case_flow.nodes)) {
    const hasPaste = uc.use_case_flow.nodes.some((n) => /verbatim|pasted/i.test(n.label || ''));
    if (!hasPaste) {
      uc.use_case_flow.nodes.unshift({ id: 'brief_paste_check', type: 'decision', label: "brief_mode = pasted & brief_content set? → use verbatim" });
    }
  }
});

writeFileSync(SEEDS, JSON.stringify(seeds, null, 2));
console.log('recipes updated: dev-clone uc_triage(+qa.bug.found listen), uc_implementation(+review_decision.approved listen); visual-brand uc_brief_generation(+brief_content)');

// ---- C: Visual Brand template — add the paste textarea question ----
const vb = JSON.parse(readFileSync(VB, 'utf8'));
const qs = vb.payload.adoption_questions;
if (!qs.some((q) => q.id === 'aq_brief_content')) {
  const briefModeIdx = qs.findIndex((q) => q.id === 'aq_brief_mode');
  const q = {
    id: 'aq_brief_content', scope: 'capability', use_case_ids: ['uc_brief_generation'], use_case_id: 'uc_brief_generation',
    category: 'domain', question: 'Paste your design.md / brand brief (only if you chose "I\'ll paste my own" above)',
    type: 'textarea', optional: true, default: '',
    maps_to: 'use_cases[uc_brief_generation].sample_input.brief_content', variable_name: 'brief_content',
    context: "Optional. If you picked \"I'll paste my own design.md\" for the brief mode, paste the full brief here (from Stitch, Figma, Gemini, or hand-written) and the agent uses it verbatim as the empathy + sensory-language source — no codebase extraction. Leave blank for auto-extract or on-demand modes.",
    dimension: 'task',
  };
  qs.splice(briefModeIdx >= 0 ? briefModeIdx + 1 : qs.length, 0, q);
  writeFileSync(VB, JSON.stringify(vb, null, 2));
  console.log('visual-brand template: added aq_brief_content textarea question after aq_brief_mode');
} else {
  console.log('aq_brief_content already present — template untouched');
}
