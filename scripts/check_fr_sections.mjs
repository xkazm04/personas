import { readFileSync } from 'fs';

const FR_PATH = 'C:/Users/kazda/kiro/personas/src/i18n/fr.ts';

function findInsertionPoints(filePath) {
  const lines = readFileSync(filePath, 'utf-8').split('\n');
  const result = new Map();
  const stack = [];
  let inExport = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!inExport) {
      if (/^export\s+const\s+\w+\s*=\s*\{/.test(trimmed)) {
        inExport = true;
        stack.push({ key: '__root__', startLine: i });
      }
      continue;
    }

    const dqRe = /"(?:[^"\\]|\\.)*"/g;
    const sqRe = /'(?:[^'\\]|\\.)*'/g;
    const stripped = trimmed.replace(dqRe, '""').replace(sqRe, "''");
    const opens = (stripped.match(/\{/g)||[]).length;
    const closes = (stripped.match(/\}/g)||[]).length;

    const keyMatch = trimmed.match(/^(?:"([^"]+)"|'([^']+)'|([\w$]+))\s*:/);
    if (keyMatch) {
      const key = keyMatch[1] ?? keyMatch[2] ?? keyMatch[3];
      const afterColon = stripped.slice(stripped.indexOf(':') + 1);
      if (afterColon.includes('{') && opens > closes) {
        stack.push({ key, startLine: i });
      }
    }

    const netClose = closes - opens;
    for (let c = 0; c < netClose; c++) {
      if (stack.length > 0) {
        const frame = stack.pop();
        const dotPath = stack.map(f => f.key).filter(k => k !== '__root__').concat(frame.key).join('.');
        result.set(dotPath, i);
      }
    }
  }
  return result;
}

const pts = findInsertionPoints(FR_PATH);
const needed = [
  'vault.auto_cred_extra','vault.cli_capture','vault.design_phases','vault.negotiator_extra','vault.reauth_banner','vault.workspace_panel',
  'overview.healing_issues_panel','overview.knowledge_graph','overview.leaderboard','overview.memories','overview.health_extra','overview.messages',
  'overview.memory_review','overview.focused_decision','overview.burn_rate_extra','overview.annotate_modal','overview.knowledge_row',
  'overview.review_focus','overview.review_inbox','overview.predictive_alerts_extra','overview.bulk_action_bar',
  'deployment.exec_detail','deployment.oauth_panel','deployment.schedules','deployment.deploy_card','deployment.trigger_form',
  'deployment.chart','deployment.deployments_panel','deployment.history','deployment.api_playground','deployment.connection',
  'templates.generation','templates.adopt_modal','templates.matrix','templates.matrix_variants','templates.n8n',
  'templates.questionnaire','templates.search','templates.gallery','templates.diagrams','templates.connector_edit','templates.trigger_edit',
  'releases.whats_new',
  'plugins.dev_tools','plugins.dev_projects','plugins.dev_context','plugins.dev_scanner','plugins.dev_runner',
  'plugins.dev_lifecycle','plugins.dev_triage','plugins.drive','plugins.obsidian','plugins.artist',
  'plugins.artist_gallery','plugins.artist_media_studio','plugins.research_lab',
  'settings.portability','settings.account','settings.appearance','settings.engine','settings.byom',
  'shared.sidebar_extra','shared.progress_extra','shared.use_cases_extra','shared.draft_editor',
  'shared.terminal_extra','shared.forms_extra','shared.execution_detail','shared.reasoning_trace'
];

// Also check top-level sections
const topLevels = ['vault','overview','deployment','templates','releases','plugins','settings','shared'];
for (const tl of topLevels) {
  console.log(tl + ': ' + (pts.has(tl) ? 'EXISTS at line ' + pts.get(tl) : 'MISSING'));
}

console.log('\nSubsections:');
for (const n of needed) {
  console.log(n + ': ' + (pts.has(n) ? 'EXISTS at line ' + pts.get(n) : 'MISSING'));
}
