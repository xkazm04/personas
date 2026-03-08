/**
 * Builtin connector definitions — committed to the repo so all users get the same catalog.
 * Each JSON file in scripts/connectors/builtin/ defines a single connector.
 */

import airtable from '../../../scripts/connectors/builtin/airtable.json';
import asana from '../../../scripts/connectors/builtin/asana.json';
import azureDevops from '../../../scripts/connectors/builtin/azure-devops.json';
import notion from '../../../scripts/connectors/builtin/notion.json';
import clickup from '../../../scripts/connectors/builtin/clickup.json';
import github from '../../../scripts/connectors/builtin/github.json';
import calCom from '../../../scripts/connectors/builtin/cal-com.json';
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
import linkedin from '../../../scripts/connectors/builtin/linkedin.json';
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
import kubernetes from '../../../scripts/connectors/builtin/kubernetes.json';
import leonardoAi from '../../../scripts/connectors/builtin/leonardo-ai.json';
import confluence from '../../../scripts/connectors/builtin/confluence.json';
import neon from '../../../scripts/connectors/builtin/neon.json';
import upstash from '../../../scripts/connectors/builtin/upstash.json';
import planetscale from '../../../scripts/connectors/builtin/planetscale.json';
import dropbox from '../../../scripts/connectors/builtin/dropbox.json';
import twilioSms from '../../../scripts/connectors/builtin/twilio-sms.json';
import postgres from '../../../scripts/connectors/builtin/postgres.json';
import mongodb from '../../../scripts/connectors/builtin/mongodb.json';
import redis from '../../../scripts/connectors/builtin/redis.json';
import duckdb from '../../../scripts/connectors/builtin/duckdb.json';
import googleSheets from '../../../scripts/connectors/builtin/google-sheets.json';
import gmail from '../../../scripts/connectors/builtin/gmail.json';
import microsoftOutlook from '../../../scripts/connectors/builtin/microsoft-outlook.json';

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
  asana,
  azureDevops,
  notion,
  clickup,
  github,
  calCom,
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
  linkedin,
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
  kubernetes,
  leonardoAi,
  confluence,
  neon,
  upstash,
  planetscale,
  dropbox,
  twilioSms,
  postgres,
  mongodb,
  redis,
  duckdb,
  googleSheets,
  gmail,
  microsoftOutlook,
] as BuiltinConnectorDef[];
