import { useMemo, useState } from 'react';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import {
  GitPullRequest, Copy, GitBranch, ExternalLink,
  ChevronDown, ChevronRight, AlertCircle, Sparkles,
} from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { useDevToolsActions } from '../hooks/useDevToolsActions';
import { SCAN_AGENTS } from '../constants/scanAgents';
import type { DevIdea } from '@/lib/bindings/DevIdea';
import type { DevTask } from '@/lib/bindings/DevTask';
import type { DevProject } from '@/lib/bindings/DevProject';

// ---------------------------------------------------------------------------
// URL + slug helpers
// ---------------------------------------------------------------------------

/**
 * Parse a GitHub URL into owner/repo. Accepts common shapes:
 *   https://github.com/acme/widgets
 *   https://github.com/acme/widgets.git
 *   git@github.com:acme/widgets.git
 * Returns null for non-GitHub hosts (GitLab etc) so callers can show the
 * right copy/open fallback instead of constructing a broken URL.
 */
function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  const stripped = url.trim().replace(/\.git$/, '');
  // HTTPS / web URL
  const httpsMatch = stripped.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/?$/i);
  if (httpsMatch) return { owner: httpsMatch[1]!, repo: httpsMatch[2]! };
  // SSH URL
  const sshMatch = stripped.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
  if (sshMatch) return { owner: sshMatch[1]!, repo: sshMatch[2]! };
  return null;
}

/**
 * Slugify an idea title for use as a branch name. Keeps the result short
 * enough that git, the filesystem, and the GitHub compare URL all stay happy
 * (remotes complain around ~255 chars but many shells get awkward well before).
 */
function slugifyForBranch(raw: string, maxLength = 50): string {
  const slug = raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')  // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return 'dev-tools-task';
  if (slug.length <= maxLength) return slug;
  // Truncate at a word boundary when possible
  const cut = slug.slice(0, maxLength);
  const lastDash = cut.lastIndexOf('-');
  return lastDash > 20 ? cut.slice(0, lastDash) : cut;
}

// ---------------------------------------------------------------------------
// PR content builder
// ---------------------------------------------------------------------------

interface PrContent {
  branchName: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
  agentLabel: string | null;
  agentEmoji: string | null;
}

function buildPrContent(
  task: DevTask,
  idea: DevIdea | null,
  taskIdShort: string,
  citationTemplate: string,
): PrContent {
  const agent = idea ? SCAN_AGENTS.find((a) => a.key === idea.scan_type) ?? null : null;
  const agentLabel = agent?.label ?? null;
  const agentEmoji = agent?.emoji ?? null;

  const titleSource = idea?.title ?? task.title;
  const slug = slugifyForBranch(titleSource);
  const branchName = `dev-tools/${slug}-${taskIdShort}`;

  const prTitle = titleSource;

  // Commit message: subject + blank line + trailer. Keep the subject under the
  // 72-char git convention so GitHub and `git log --oneline` render cleanly.
  const subject = prTitle.length > 72 ? `${prTitle.slice(0, 69)}...` : prTitle;
  const commitMessage = agent
    ? `${subject}\n\nProposed by ${agent.label} ${agent.emoji} via Personas Dev Tools.${
        idea?.reasoning ? `\n\n${idea.reasoning}` : ''
      }`
    : subject;

  // PR body: markdown, idea-centric. Reasoning is the payload that makes the
  // agent citation worthwhile — without it we're just generating empty shells.
  const bodyParts: string[] = [];
  if (agent) {
    bodyParts.push(`## ${citationTemplate.replace('{label}', agent.label).replace('{emoji}', agent.emoji)}`);
  } else {
    bodyParts.push(`## ${prTitle}`);
  }
  if (idea) {
    const metadata: string[] = [];
    if (idea.category) metadata.push(`**Category:** ${idea.category}`);
    if (typeof idea.effort === 'number') metadata.push(`**Effort:** ${idea.effort}/10`);
    if (typeof idea.impact === 'number') metadata.push(`**Impact:** ${idea.impact}/10`);
    if (typeof idea.risk === 'number') metadata.push(`**Risk:** ${idea.risk}/10`);
    if (metadata.length > 0) bodyParts.push(metadata.join('  \u00B7  '));
    if (idea.description) bodyParts.push(`### Description\n${idea.description}`);
    if (idea.reasoning) bodyParts.push(`### Agent reasoning\n${idea.reasoning}`);
  } else if (task.description) {
    bodyParts.push(task.description);
  }
  bodyParts.push('---');
  bodyParts.push('_Generated via Personas Dev Tools._');
  const prBody = bodyParts.join('\n\n');

  return { branchName, commitMessage, prTitle, prBody, agentLabel, agentEmoji };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Look up the idea that spawned this task. Returns null for manual tasks. */
function useSourceIdea(task: DevTask): DevIdea | null {
  return useSystemStore((s) =>
    task.source_idea_id ? s.ideas.find((i) => i.id === task.source_idea_id) ?? null : null,
  );
}

function useActiveProject(): DevProject | null {
  return useSystemStore((s) =>
    s.activeProjectId ? s.projects.find((p) => p.id === s.activeProjectId) ?? null : null,
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PrBridge({ task }: { task: DevTask }) {
  const { t, tx } = useTranslation();
  const dt = t.plugins.dev_tools;
  const project = useActiveProject();
  const idea = useSourceIdea(task);
  const { createBranch, commitChanges } = useDevToolsActions();
  const addToast = useToastStore((s) => s.addToast);
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);

  const [expanded, setExpanded] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [opening, setOpening] = useState(false);

  const ghRepo = useMemo(
    () => (project?.github_url ? parseGitHubRepo(project.github_url) : null),
    [project?.github_url],
  );

  const content = useMemo(
    () => buildPrContent(task, idea, task.id.slice(0, 7), dt.pr_bridge_agent_citation),
    [task, idea, dt.pr_bridge_agent_citation],
  );

  const hasGithubUrl = Boolean(project?.github_url);
  const hasRecognizedRepo = Boolean(ghRepo);

  const handleCopyBody = async () => {
    try {
      await navigator.clipboard.writeText(content.prBody);
      addToast(dt.pr_bridge_copied, 'success');
    } catch {
      addToast(dt.pr_bridge_copy_failed, 'error');
    }
  };

  const handleCopyAll = async () => {
    const combined = `# ${content.prTitle}\n\nBranch: \`${content.branchName}\`\n\nCommit:\n\`\`\`\n${content.commitMessage}\n\`\`\`\n\n${content.prBody}`;
    try {
      await navigator.clipboard.writeText(combined);
      addToast(dt.pr_bridge_copied, 'success');
    } catch {
      addToast(dt.pr_bridge_copy_failed, 'error');
    }
  };

  const handlePrepareBranch = async () => {
    if (!project) return;
    setPreparing(true);
    try {
      await createBranch(project.id, content.branchName);
      await commitChanges(project.id, content.commitMessage, true);
      addToast(tx(dt.pr_bridge_branch_prepared, { branch: content.branchName }), 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast(tx(dt.pr_bridge_branch_failed, { message: msg }), 'error');
    } finally {
      setPreparing(false);
    }
  };

  const handleOpenGithub = async () => {
    if (!ghRepo) return;
    setOpening(true);
    try {
      // GitHub's compare URL supports quick_pull + title + body pre-fill. The
      // draft toggle lives on the form itself — no query param exists — so we
      // surface a hint below the button instead.
      const params = new URLSearchParams({
        quick_pull: '1',
        title: content.prTitle,
        body: content.prBody,
      });
      // The base branch is usually the repo default (main/master). We don't
      // fetch remote metadata here — GitHub defaults to the repo's default
      // branch when `base` is omitted from the compare path.
      const url = `https://github.com/${ghRepo.owner}/${ghRepo.repo}/pull/new/${encodeURIComponent(content.branchName)}?${params.toString()}`;
      await openExternal(url);
    } catch {
      addToast(dt.pr_bridge_open_failed, 'error');
    } finally {
      setOpening(false);
    }
  };

  // Only show for completed tasks — avoids suggesting PRs for work in flight.
  if (task.status !== 'completed') return null;

  return (
    <div className="border-t border-primary/10 bg-primary/3">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-primary/5 transition-colors text-left"
        aria-expanded={expanded}
      >
        <div className="w-7 h-7 rounded-card bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center flex-shrink-0">
          <GitPullRequest className="w-3.5 h-3.5 text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="typo-card-label">{dt.pr_bridge_title}</span>
            {content.agentLabel && content.agentEmoji && (
              <span className="inline-flex items-center gap-1 text-[10px] text-foreground bg-primary/5 border border-primary/10 rounded-full px-2 py-0.5">
                <Sparkles className="w-2.5 h-2.5 text-violet-400" />
                <span>{content.agentEmoji}</span>
                <span>{content.agentLabel}</span>
              </span>
            )}
          </div>
          <p className="text-[10px] text-foreground truncate">
            {expanded ? dt.pr_bridge_collapse : dt.pr_bridge_subtitle}
          </p>
        </div>
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5 text-foreground flex-shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-foreground flex-shrink-0" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* No GitHub URL — direct the user to fix the root cause rather than dead-end. */}
          {!hasGithubUrl && (
            <div className="flex items-center gap-3 rounded-card border border-amber-500/20 bg-amber-500/5 px-3 py-2">
              <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <p className="typo-caption text-foreground flex-1">{dt.pr_bridge_no_github}</p>
              <Button
                variant="secondary"
                size="xs"
                icon={<ExternalLink className="w-3 h-3" />}
                onClick={() => setDevToolsTab('projects')}
              >
                {dt.pr_bridge_link_project}
              </Button>
            </div>
          )}

          {/* GitHub URL but host not recognized (GitLab etc). Let the user copy the body. */}
          {hasGithubUrl && !hasRecognizedRepo && (
            <div className="flex items-center gap-3 rounded-card border border-amber-500/20 bg-amber-500/5 px-3 py-2">
              <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <p className="typo-caption text-foreground">{dt.pr_bridge_unsupported_host}</p>
            </div>
          )}

          {/* PR preview fields */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <PreviewField label={dt.pr_bridge_branch} mono>
              <code className="typo-caption text-foreground">{content.branchName}</code>
            </PreviewField>
            <PreviewField label={dt.pr_bridge_pr_title}>
              <span className="typo-caption text-foreground">{content.prTitle}</span>
            </PreviewField>
            <PreviewField label={dt.pr_bridge_commit_msg} mono fullRow>
              <pre className="text-[11px] text-foreground whitespace-pre-wrap font-mono max-h-24 overflow-y-auto">
                {content.commitMessage}
              </pre>
            </PreviewField>
            <PreviewField label={dt.pr_bridge_pr_body} mono fullRow>
              <pre className="text-[11px] text-foreground whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">
                {content.prBody}
              </pre>
            </PreviewField>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              variant="secondary"
              size="sm"
              icon={<Copy className="w-3.5 h-3.5" />}
              onClick={handleCopyBody}
            >
              {dt.pr_bridge_copy_body}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Copy className="w-3.5 h-3.5" />}
              onClick={handleCopyAll}
            >
              {dt.pr_bridge_copy_all}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<GitBranch className="w-3.5 h-3.5" />}
              loading={preparing}
              disabled={!project || preparing}
              onClick={handlePrepareBranch}
            >
              {dt.pr_bridge_prepare}
            </Button>
            <Button
              variant="accent"
              accentColor="emerald"
              size="sm"
              icon={<GitPullRequest className="w-3.5 h-3.5" />}
              loading={opening}
              disabled={!hasRecognizedRepo || opening}
              onClick={handleOpenGithub}
            >
              {dt.pr_bridge_open_github}
            </Button>
          </div>

          {hasRecognizedRepo && (
            <p className="text-[10px] text-foreground leading-relaxed">{dt.pr_bridge_draft_hint}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiny labelled preview field
// ---------------------------------------------------------------------------

function PreviewField({
  label,
  children,
  mono: _mono,
  fullRow,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  fullRow?: boolean;
}) {
  return (
    <div className={`rounded-card border border-primary/10 bg-primary/3 px-3 py-2 ${fullRow ? 'lg:col-span-2' : ''}`}>
      <span className="block text-[9px] uppercase tracking-wider font-medium text-primary mb-1">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
