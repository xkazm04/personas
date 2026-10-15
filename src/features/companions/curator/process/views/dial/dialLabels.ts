import type { ProcessStrings } from '../../labels';

export type DialStrings = ProcessStrings['dial'];

/** A step kind in the registry's vocabulary, in the reader's language. An unknown kind is shown as it is. */
export function kindName(d: DialStrings, kind: string): string {
  switch (kind) {
    case 'ask': return d.kind_ask;
    case 'browser': return d.kind_browser;
    case 'build': return d.kind_build;
    case 'commit': return d.kind_commit;
    case 'delegate': return d.kind_delegate;
    case 'edit': return d.kind_edit;
    case 'git': return d.kind_git;
    case 'mcp': return d.kind_mcp;
    case 'plan': return d.kind_plan;
    case 'prompt': return d.kind_prompt;
    case 'push': return d.kind_push;
    case 'read': return d.kind_read;
    case 'shell': return d.kind_shell;
    case 'skill': return d.kind_skill;
    case 'tool': return d.kind_tool;
    case 'verify': return d.kind_verify;
    case 'web': return d.kind_web;
    default: return kind;
  }
}
