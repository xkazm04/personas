import type { BuiltinTemplate } from '@/lib/types/templateTypes';

import codeReviewer from '../../../scripts/templates/builtin/code-reviewer.json';
import slackStandup from '../../../scripts/templates/builtin/slack-standup.json';
import securityAuditor from '../../../scripts/templates/builtin/security-auditor.json';
import docWriter from '../../../scripts/templates/builtin/doc-writer.json';
import testGenerator from '../../../scripts/templates/builtin/test-generator.json';
import depUpdater from '../../../scripts/templates/builtin/dep-updater.json';
import bugTriager from '../../../scripts/templates/builtin/bug-triager.json';
import dataMonitor from '../../../scripts/templates/builtin/data-monitor.json';

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  codeReviewer,
  slackStandup,
  securityAuditor,
  docWriter,
  testGenerator,
  depUpdater,
  bugTriager,
  dataMonitor,
] as BuiltinTemplate[];
