import { Newspaper, GitBranch, MessageSquare, Users, CalendarClock } from 'lucide-react';
import type { EventCanvasTemplate } from './eventCanvasTemplateTypes';

export const EVENT_CANVAS_TEMPLATES: EventCanvasTemplate[] = [
  {
    id: 'news-monitor',
    name: 'News Monitor',
    description: 'Webhook receives news articles, fan-out to a summarizer and a notifier persona.',
    icon: Newspaper,
    color: 'text-blue-400',
    tags: ['webhook', 'fan-out', 'news'],
    nodes: [
      { id: 'src-webhook', label: 'Webhook: News', nodeType: 'event_source', x: 100, y: 120, eventType: 'webhook_received', icon: '📰', color: 'text-blue-400' },
      { id: 'persona-summarizer', label: 'Summarizer', nodeType: 'persona_consumer', x: 500, y: 60, personaRole: 'summarizer' },
      { id: 'persona-notifier', label: 'Notifier', nodeType: 'persona_consumer', x: 500, y: 200, personaRole: 'notifier' },
    ],
    edges: [
      { sourceNodeId: 'src-webhook', targetNodeId: 'persona-summarizer', eventType: 'webhook_received' },
      { sourceNodeId: 'src-webhook', targetNodeId: 'persona-notifier', eventType: 'webhook_received' },
    ],
  },
  {
    id: 'cicd-pipeline',
    name: 'CI/CD Pipeline',
    description: 'GitHub webhook triggers build monitoring with deploy guardian and notification personas.',
    icon: GitBranch,
    color: 'text-emerald-400',
    tags: ['webhook', 'ci/cd', 'deployment'],
    nodes: [
      { id: 'src-github', label: 'GitHub Webhook', nodeType: 'event_source', x: 100, y: 120, eventType: 'webhook_received', icon: '🔗', color: 'text-blue-400' },
      { id: 'persona-guardian', label: 'Deploy Guardian', nodeType: 'persona_consumer', x: 500, y: 60, personaRole: 'deploy guardian' },
      { id: 'persona-notifier', label: 'CI Notifier', nodeType: 'persona_consumer', x: 500, y: 200, personaRole: 'notifier' },
    ],
    edges: [
      { sourceNodeId: 'src-github', targetNodeId: 'persona-guardian', eventType: 'webhook_received' },
      { sourceNodeId: 'src-github', targetNodeId: 'persona-notifier', eventType: 'webhook_received' },
    ],
  },
  {
    id: 'social-tracker',
    name: 'Social Media Tracker',
    description: 'Poll social endpoints for mentions, route to sentiment analysis and response drafting.',
    icon: MessageSquare,
    color: 'text-pink-400',
    tags: ['polling', 'social', 'analysis'],
    nodes: [
      { id: 'src-polling', label: 'Social Poll', nodeType: 'event_source', x: 100, y: 120, eventType: 'polling_changed', icon: '📊', color: 'text-teal-400' },
      { id: 'persona-analyzer', label: 'Sentiment Analyzer', nodeType: 'persona_consumer', x: 500, y: 60, personaRole: 'analyst' },
      { id: 'persona-responder', label: 'Response Drafter', nodeType: 'persona_consumer', x: 500, y: 200, personaRole: 'writer' },
    ],
    edges: [
      { sourceNodeId: 'src-polling', targetNodeId: 'persona-analyzer', eventType: 'polling_changed' },
      { sourceNodeId: 'src-polling', targetNodeId: 'persona-responder', eventType: 'polling_changed' },
    ],
  },
  {
    id: 'feedback-router',
    name: 'Customer Feedback Router',
    description: 'Webhook receives feedback, fan-out to specialist personas by category.',
    icon: Users,
    color: 'text-amber-400',
    tags: ['webhook', 'routing', 'customer'],
    nodes: [
      { id: 'src-feedback', label: 'Feedback Webhook', nodeType: 'event_source', x: 100, y: 160, eventType: 'webhook_received', icon: '💬', color: 'text-blue-400' },
      { id: 'persona-router', label: 'Router', nodeType: 'persona_consumer', x: 500, y: 60, personaRole: 'router' },
      { id: 'persona-specialist-a', label: 'Specialist A', nodeType: 'persona_consumer', x: 500, y: 160, personaRole: 'specialist' },
      { id: 'persona-specialist-b', label: 'Specialist B', nodeType: 'persona_consumer', x: 500, y: 260, personaRole: 'specialist' },
    ],
    edges: [
      { sourceNodeId: 'src-feedback', targetNodeId: 'persona-router', eventType: 'webhook_received' },
      { sourceNodeId: 'src-feedback', targetNodeId: 'persona-specialist-a', eventType: 'webhook_received' },
      { sourceNodeId: 'src-feedback', targetNodeId: 'persona-specialist-b', eventType: 'webhook_received' },
    ],
  },
  {
    id: 'scheduled-reports',
    name: 'Scheduled Report Generator',
    description: 'Cron-triggered data collection and report generation pipeline.',
    icon: CalendarClock,
    color: 'text-violet-400',
    tags: ['schedule', 'reports', 'automation'],
    nodes: [
      { id: 'src-cron', label: 'Daily Schedule', nodeType: 'event_source', x: 100, y: 120, eventType: 'schedule_fired', icon: '⏰', color: 'text-amber-400' },
      { id: 'persona-collector', label: 'Data Collector', nodeType: 'persona_consumer', x: 500, y: 60, personaRole: 'data collector' },
      { id: 'persona-writer', label: 'Report Writer', nodeType: 'persona_consumer', x: 500, y: 200, personaRole: 'writer' },
    ],
    edges: [
      { sourceNodeId: 'src-cron', targetNodeId: 'persona-collector', eventType: 'schedule_fired' },
      { sourceNodeId: 'src-cron', targetNodeId: 'persona-writer', eventType: 'schedule_fired' },
    ],
  },
];
