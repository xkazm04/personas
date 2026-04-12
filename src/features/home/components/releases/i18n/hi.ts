// TODO(i18n-hi): translate from English placeholders. Structure must match en.ts exactly.
// See `.claude/CLAUDE.md` → "UI Conventions → Internationalization" for the convention.
export const hi = {
  whatsNew: {
    title: "What's New",
    subtitle: {
      roadmap: "What we're building now and what comes next.",
      changelog: "What's new in your version of Personas.",
    },
    navBar: {
      roadmapLabel: 'Roadmap',
    },
    status: {
      released: 'Released',
      active: 'Current',
      planned: 'Planned',
      roadmap: 'Roadmap',
    },
    type: {
      feature: 'New',
      fix: 'Fixed',
      security: 'Security',
      docs: 'Docs',
      chore: 'Chore',
      breaking: 'Breaking',
    },
    itemStatus: {
      in_progress: 'In Progress',
      planned: 'Planned',
      completed: 'Done',
    },
    priority: {
      now: 'Now',
      next: 'Next',
      later: 'Later',
    },
    summary: {
      inProgress: '{count} In Progress',
      next: '{count} Next',
    },
    empty: 'Nothing to share for this release yet — check back soon.',
    releases: {
      '0.0.1': {
        label: 'Alpha 1',
        summary: 'The first preview of Personas.',
        items: {
          '1': {
            title: 'First public preview',
            description:
              'Design AI agents, run them on a schedule or trigger, and watch their work live on your desktop.',
          },
        },
      },
      '0.0.2': {
        label: 'Alpha 2',
        summary: "Connect Personas to other AI tools and read what's new without leaving the app.",
        items: {
          '1': {
            title: 'Open your agents to other AI tools',
            description:
              "Personas can now talk to other AI tools through a shared protocol. Pick exactly which agents you want to share, and protect them with access keys you control — your private agents stay private by default.",
          },
          '2': {
            title: 'Safer access for the desktop app',
            description:
              "The desktop app creates its own short-lived access key on every launch, so it can talk to its background services without exposing anything you didn't approve.",
          },
          '3': {
            title: 'Release notes inside the app',
            description:
              "See what's new in every Personas release without leaving the app. Switch between past versions, the current release, and the long-term roadmap from one place.",
          },
          '4': {
            title: 'Your agents learn from every session',
            description:
              "Personas now captures the lessons from each agent session, distills them into reusable knowledge, and brings them forward to the next run. Your agents get smarter the longer you use them — no manual training needed.",
          },
          // TODO(i18n-hi): untranslated — English source-of-truth added 2026-04-12
          '5': {
            title: 'Turn any document into a listenable briefing',
            description:
              'A new template that turns research reports, meeting transcripts, or long articles into a 5- to 15-minute two-host audio conversation you can listen to on the go. You pick the style — casual, formal, news, or executive — and review the script before the voices are generated.',
          },
          // TODO(i18n-hi): untranslated — English source-of-truth added 2026-04-12
          '6': {
            title: 'A Stanford-trained editor for your writing',
            description:
              'A new template that reviews your drafts using the Stanford "Writing in the Sciences" method. It flags passive voice, dead-weight phrases, and jargon — and explains exactly why every suggested change makes the sentence clearer. It learns your voice from the edits you accept or reject.',
          },
        },
      },
      roadmap: {
        label: 'Roadmap',
        summary: "What we're building now and what comes next.",
        items: {
          '2': {
            title: 'Cloud Integration',
            description:
              'Run your agents 24/7 in the cloud and stream their work back to your desktop in real time.',
          },
          '3': {
            title: 'Web App',
            description:
              'A web companion for accounts, billing, and managing agents from any browser.',
          },
          '4': {
            title: 'Use Personas in your language',
            description:
              'Full multi-language support, including right-to-left layouts and language-specific fonts.',
          },
          '6': {
            title: 'Team Workspaces',
            description:
              'Build agents together with your team — shared spaces, role permissions, and live dashboards.',
          },
        },
      },
    },
  },
};
