/**
 * Builtin connector definitions — committed to the repo so all users get the same catalog.
 * Each JSON file in scripts/connectors/builtin/ defines a single connector.
 */

import airtable from '../../../scripts/connectors/builtin/airtable.json';
import notion from '../../../scripts/connectors/builtin/notion.json';
import clickup from '../../../scripts/connectors/builtin/clickup.json';
import github from '../../../scripts/connectors/builtin/github.json';
import calendly from '../../../scripts/connectors/builtin/calendly.json';
import supabase from '../../../scripts/connectors/builtin/supabase.json';
import sentry from '../../../scripts/connectors/builtin/sentry.json';
import betterstack from '../../../scripts/connectors/builtin/betterstack.json';
import mixpanel from '../../../scripts/connectors/builtin/mixpanel.json';
import twilioSegment from '../../../scripts/connectors/builtin/twilio-segment.json';
import monday from '../../../scripts/connectors/builtin/monday.json';
import linear from '../../../scripts/connectors/builtin/linear.json';
import posthog from '../../../scripts/connectors/builtin/posthog.json';
import circleci from '../../../scripts/connectors/builtin/circleci.json';
import convex from '../../../scripts/connectors/builtin/convex.json';
import buffer from '../../../scripts/connectors/builtin/buffer.json';
import slack from '../../../scripts/connectors/builtin/slack.json';
import discord from '../../../scripts/connectors/builtin/discord.json';
import telegram from '../../../scripts/connectors/builtin/telegram.json';
import sendgrid from '../../../scripts/connectors/builtin/sendgrid.json';
import resend from '../../../scripts/connectors/builtin/resend.json';
import vercel from '../../../scripts/connectors/builtin/vercel.json';
import netlify from '../../../scripts/connectors/builtin/netlify.json';
import cloudflare from '../../../scripts/connectors/builtin/cloudflare.json';
import figma from '../../../scripts/connectors/builtin/figma.json';
import hubspot from '../../../scripts/connectors/builtin/hubspot.json';
import jira from '../../../scripts/connectors/builtin/jira.json';
import confluence from '../../../scripts/connectors/builtin/confluence.json';
import neon from '../../../scripts/connectors/builtin/neon.json';
import upstash from '../../../scripts/connectors/builtin/upstash.json';
import planetscale from '../../../scripts/connectors/builtin/planetscale.json';
import dropbox from '../../../scripts/connectors/builtin/dropbox.json';
import twilioSms from '../../../scripts/connectors/builtin/twilio-sms.json';

export interface BuiltinConnectorDef {
  id: string;
  name: string;
  label: string;
  color: string;
  icon_url?: string;
  category: string;
  fields: Array<{
    key: string;
    label: string;
    type: string;
    required?: boolean;
    placeholder?: string;
    helpText?: string;
  }>;
  healthcheck_config: Record<string, unknown> | null;
  services: unknown[];
  events: unknown[];
  metadata: Record<string, unknown> | null;
}

export const BUILTIN_CONNECTORS: BuiltinConnectorDef[] = [
  airtable,
  notion,
  clickup,
  github,
  calendly,
  supabase,
  sentry,
  betterstack,
  mixpanel,
  twilioSegment,
  monday,
  linear,
  posthog,
  circleci,
  convex,
  buffer,
  slack,
  discord,
  telegram,
  sendgrid,
  resend,
  vercel,
  netlify,
  cloudflare,
  figma,
  hubspot,
  jira,
  confluence,
  neon,
  upstash,
  planetscale,
  dropbox,
  twilioSms,
] as BuiltinConnectorDef[];
