// Provenance — the "why does it say this?" for a dimension. Each line is grounded
// in the actual signals the derive read (context count, standards flags, bound
// credentials, detected tables), so a rating is auditable instead of magic. Shown
// in the cell popover above the ladder/actions; also feeds the exported report.
//
// The sentences live in `plugins.dev_tools.improve_why_*`; this module resolves
// them against the `t` it is handed (it has no render context of its own).
import { interpolate, type Translations } from '@/i18n/useTranslation';
import type { ImproveRaw } from './ImproveContext';
import { parseStandards } from './standards';

export function dimensionReason(rowKey: string, raw: ImproveRaw, t: Translations): string | null {
  const d = t.plugins.dev_tools;
  const tx = interpolate;
  const { meta, project } = raw;
  const ev = raw.evidence;
  const std = parseStandards(project.standards_config);
  const tables = meta.db_tables?.length ?? 0;
  switch (rowKey) {
    case 'context': {
      const n = meta.context_count;
      const sentence = n >= 20 ? d.improve_why_context_full : n >= 5 ? d.improve_why_context_partial : d.improve_why_context_sparse;
      return tx(sentence, { count: n });
    }
    case 'ci': {
      const gates = [
        std.precommit.lint && d.improve_why_gate_lint,
        std.precommit.code_quality && d.improve_why_gate_quality,
        std.branching.pr_base && d.improve_why_gate_pr,
        std.branching.automerge.enabled && d.improve_why_gate_automerge,
      ].filter(Boolean);
      return gates.length ? tx(d.improve_why_ci, { gates: gates.join(', ') }) : d.improve_why_ci_none;
    }
    // The "no …" lines below are only true when the derive saw no signal. When
    // it did (passportDerive reads the same evidence), the row already shows
    // the rung it reached, and the old fixed sentence contradicted it - so say
    // nothing rather than something false.
    case 'tests':
      return ev?.has_tests ? null : d.improve_why_tests_none;
    case 'security':
      if (ev?.has_codeql || ev?.has_dependabot) return null;
      return project.standards_config ? d.improve_why_security_policy : d.improve_why_security_none;
    case 'observability':
    case 'errors':
    case 'logs':
    case 'metrics':
    case 'tracing':
      return project.monitoring_credential_id ? d.improve_why_monitor_bound : d.improve_why_monitor_unbound;
    case 'llmtracking':
      return project.llm_tracking_credential_id ? d.improve_why_llm_bound : d.improve_why_llm_unbound;
    case 'evals':
      return ev?.has_eval ? null : d.improve_why_evals_none;
    case 'migrations':
      if (ev?.has_migrations && tables === 0) return null;
      return tables > 0 ? tx(d.improve_why_mig_tables, { count: tables }) : d.improve_why_mig_none;
    case 'instructions':
      if (project.team_id) return d.improve_why_instr_team;
      return ev?.has_claude_md ? null : d.improve_why_instr_none;
    case 'docs': {
      const n = ev?.docs_file_count ?? 0;
      const rot = raw.docRot;
      // "all N tracked docs are current" used to be printed whenever nothing
      // was stale — including when most of those docs had no coupling at all
      // and so could not have been judged. Say what was actually established.
      let rotBit = '';
      if (rot) {
        const parts: string[] = [];
        if (rot.dirty > 0) parts.push(tx(d.improve_why_rot_stale, { count: rot.dirty }));
        if (rot.broken > 0) parts.push(tx(d.improve_why_rot_broken, { count: rot.broken }));
        if (rot.unverifiable > 0) parts.push(tx(d.improve_why_rot_unverifiable, { count: rot.unverifiable }));
        rotBit = parts.length
          ? tx(d.improve_why_rot_summary, { tracked: rot.tracked, parts: parts.join('; ') })
          : tx(d.improve_why_rot_clean, { tracked: rot.tracked });
      }
      let lead: string;
      if (ev?.has_doc_map) lead = tx(d.improve_why_docs_map, { count: n });
      else if (n >= 3) lead = tx(d.improve_why_docs_nomap, { count: n });
      else lead = ev?.has_readme ? d.improve_why_docs_readme : d.improve_why_docs_none;
      return rotBit ? `${lead} ${rotBit}` : lead;
    }
    case 'memory': {
      const files = ev?.memory_file_count ?? 0;
      const idx = ev?.memory_index_lines ?? 0;
      const age = ev?.memory_age_days;
      const mh = raw.memHealth;
      let healthBit = '';
      if (mh) {
        healthBit = mh.disputed > 0
          ? tx(mh.disputed === 1 ? d.improve_why_mem_health_disputed_one : d.improve_why_mem_health_disputed_other, { score: mh.score, count: mh.disputed })
          : tx(d.improve_why_mem_health, { score: mh.score });
      }
      let lead: string;
      if (files > 0) lead = age != null ? tx(d.improve_why_mem_files_age, { files, index: idx, age }) : tx(d.improve_why_mem_files, { files, index: idx });
      else lead = ev?.has_repo_memory ? d.improve_why_mem_repo : d.improve_why_mem_none;
      return healthBit ? `${lead} ${healthBit}` : lead;
    }
    case 'aiflow':
      if (project.pr_credential_id) return d.improve_why_ai_pr;
      return project.team_id ? null : d.improve_why_ai_none;
    case 'skills':
      return raw.hasSkills ? d.improve_why_skills_yes : d.improve_why_skills_none;
    case 'selfverify':
      return d.improve_why_selfverify;
    default:
      return null;
  }
}
