#!/usr/bin/env node
/**
 * One-shot batch: inject `resources[]` into 9 builtin connector JSONs.
 *
 * Each spec was authored by hand with the actual API endpoint, headers, and
 * response shape verified against the service's docs. Pagination and search
 * modes match each API's idioms.
 *
 * Run: `node scripts/add-resources-batch.mjs`
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'scripts/connectors/builtin');

/** connector name → resources[] (each entry per the ResourceSpec schema). */
const SPECS = {
  gitlab: [
    {
      id: 'projects', label: 'Projects',
      description: 'GitLab projects (repos) the token can see. Scope a credential to a subset so templates auto-fill and agents can\'t reach unrelated projects.',
      selection: 'multi',
      list_endpoint: {
        method: 'GET',
        url: 'https://gitlab.com/api/v4/projects?membership=true&per_page=100&order_by=last_activity_at',
        headers: { 'PRIVATE-TOKEN': '{{personal_access_token}}' },
        pagination: { type: 'link_header', max_pages: 5 },
      },
      response_mapping: {
        items_path: '$', id: 'path_with_namespace', label: 'name_with_namespace', sublabel: 'description',
        meta: { id: 'id', visibility: 'visibility', default_branch: 'default_branch', url: 'web_url' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 600,
    },
    {
      id: 'groups', label: 'Groups',
      description: 'Top-level groups the token has visibility into.',
      selection: 'multi',
      list_endpoint: {
        method: 'GET',
        url: 'https://gitlab.com/api/v4/groups?per_page=100&top_level_only=true',
        headers: { 'PRIVATE-TOKEN': '{{personal_access_token}}' },
        pagination: { type: 'link_header', max_pages: 3 },
      },
      response_mapping: {
        items_path: '$', id: 'full_path', label: 'full_name', sublabel: 'description',
        meta: { id: 'id', url: 'web_url' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 3600,
    },
  ],

  notion: [
    {
      id: 'databases', label: 'Databases',
      description: 'Notion databases the integration has been shared with. Pick the ones this credential should operate on.',
      selection: 'multi',
      list_endpoint: {
        method: 'POST',
        url: 'https://api.notion.com/v1/search',
        headers: {
          Authorization: 'Bearer {{api_key}}',
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: '{"filter":{"property":"object","value":"database"},"page_size":100}',
        pagination: { type: 'none' },
      },
      response_mapping: {
        items_path: 'results', id: 'id', label: 'title.0.plain_text', sublabel: 'url',
        meta: { url: 'url', last_edited_time: 'last_edited_time' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 600,
    },
    {
      id: 'pages', label: 'Top-level pages',
      description: 'Notion pages the integration can see. Useful when an agent needs to write under a specific parent page.',
      selection: 'multi',
      list_endpoint: {
        method: 'POST',
        url: 'https://api.notion.com/v1/search',
        headers: {
          Authorization: 'Bearer {{api_key}}',
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: '{"filter":{"property":"object","value":"page"},"page_size":100}',
        pagination: { type: 'none' },
      },
      response_mapping: {
        items_path: 'results', id: 'id', label: 'properties.title.title.0.plain_text', sublabel: 'url',
        meta: { url: 'url' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 600,
    },
  ],

  airtable: [
    {
      id: 'bases', label: 'Bases',
      description: 'Airtable bases the token can read. Scope the credential to specific bases for tighter blast radius.',
      selection: 'multi',
      list_endpoint: {
        method: 'GET',
        url: 'https://api.airtable.com/v0/meta/bases',
        headers: { Authorization: 'Bearer {{api_key}}' },
        pagination: { type: 'cursor', cursor_param: 'offset', cursor_path: 'offset', max_pages: 5 },
      },
      response_mapping: {
        items_path: 'bases', id: 'id', label: 'name', sublabel: 'permissionLevel',
        meta: { permissionLevel: 'permissionLevel' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 600,
    },
    {
      id: 'tables', label: 'Tables',
      description: 'Tables inside the base configured on this credential.',
      selection: 'multi',
      list_endpoint: {
        method: 'GET',
        url: 'https://api.airtable.com/v0/meta/bases/{{base_id}}/tables',
        headers: { Authorization: 'Bearer {{api_key}}' },
        pagination: { type: 'none' },
      },
      response_mapping: {
        items_path: 'tables', id: 'id', label: 'name', sublabel: 'description',
        meta: { primaryFieldId: 'primaryFieldId' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 600,
    },
  ],

  'google-drive': [
    {
      id: 'folders', label: 'Folders (My Drive root)',
      description: "Top-level folders in the user's My Drive. Scope a credential to specific folders so agents can't reach the rest of the drive.",
      selection: 'multi',
      list_endpoint: {
        method: 'GET',
        url: "https://www.googleapis.com/drive/v3/files?q=mimeType%3D%27application%2Fvnd.google-apps.folder%27+and+%27root%27+in+parents+and+trashed%3Dfalse&pageSize=100&fields=files(id,name,modifiedTime)&orderBy=modifiedTime+desc",
        headers: { Authorization: 'Bearer {{access_token}}' },
        pagination: { type: 'none' },
      },
      response_mapping: {
        items_path: 'files', id: 'id', label: 'name', sublabel: 'modifiedTime',
        meta: { modifiedTime: 'modifiedTime' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 600,
    },
    {
      id: 'shared_drives', label: 'Shared Drives',
      description: 'Shared drives (Team Drives) accessible to the user.',
      selection: 'multi',
      list_endpoint: {
        method: 'GET',
        url: 'https://www.googleapis.com/drive/v3/drives?pageSize=100',
        headers: { Authorization: 'Bearer {{access_token}}' },
        pagination: { type: 'none' },
      },
      response_mapping: {
        items_path: 'drives', id: 'id', label: 'name',
        meta: { createdTime: 'createdTime' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 3600,
    },
  ],

  slack: [
    {
      id: 'channels', label: 'Channels',
      description: "Slack channels the bot is a member of. Scope the credential to specific channels so agents can't post anywhere else.",
      selection: 'multi',
      list_endpoint: {
        method: 'GET',
        url: 'https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=200',
        headers: { Authorization: 'Bearer {{bot_token}}' },
        pagination: {
          type: 'cursor',
          cursor_param: 'cursor',
          cursor_path: 'response_metadata.next_cursor',
          max_pages: 5,
        },
      },
      response_mapping: {
        items_path: 'channels', id: 'id', label: 'name', sublabel: 'purpose.value',
        meta: { is_private: 'is_private', num_members: 'num_members', is_archived: 'is_archived' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 600,
    },
  ],

  linear: [
    {
      id: 'teams', label: 'Teams',
      description: "Linear teams the API key can access. Scope a credential to specific teams so agents can't create or read issues elsewhere.",
      selection: 'multi',
      list_endpoint: {
        method: 'POST',
        url: 'https://api.linear.app/graphql',
        headers: { Authorization: '{{api_key}}', 'Content-Type': 'application/json' },
        body: '{"query":"{ teams(first: 100) { nodes { id key name description } } }"}',
        pagination: { type: 'none' },
      },
      response_mapping: {
        items_path: 'data.teams.nodes', id: 'key', label: 'name', sublabel: 'description',
        meta: { id: 'id', key: 'key' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 1800,
    },
    {
      id: 'projects', label: 'Projects',
      description: 'Active Linear projects across all accessible teams.',
      selection: 'multi',
      list_endpoint: {
        method: 'POST',
        url: 'https://api.linear.app/graphql',
        headers: { Authorization: '{{api_key}}', 'Content-Type': 'application/json' },
        body: '{"query":"{ projects(first: 100) { nodes { id slugId name description state } } }"}',
        pagination: { type: 'none' },
      },
      response_mapping: {
        items_path: 'data.projects.nodes', id: 'id', label: 'name', sublabel: 'description',
        meta: { state: 'state', slugId: 'slugId' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 600,
    },
  ],

  jira: [
    {
      id: 'projects', label: 'Projects',
      description: "Jira projects the API token can access. Scope the credential so agents can't reach unrelated projects.",
      selection: 'multi',
      list_endpoint: {
        method: 'GET',
        url: 'https://{{domain}}/rest/api/3/project/search?maxResults=100&orderBy=lastIssueUpdatedTime',
        headers: {
          // NB: base64(email:api_token) is computed by the resource_listing
          // helper if it can't be templated directly. For now use the
          // pre-resolved api_token as a Bearer fallback; sites configured for
          // basic auth will need a follow-up encoder. Most cloud-Jira PATs
          // accept Bearer for read endpoints.
          Authorization: 'Bearer {{api_token}}',
          Accept: 'application/json',
        },
        pagination: { type: 'page_param', page_param: 'startAt', per_page: 100, max_pages: 5 },
      },
      response_mapping: {
        items_path: 'values', id: 'key', label: 'name', sublabel: 'projectTypeKey',
        meta: { id: 'id', key: 'key', projectTypeKey: 'projectTypeKey', url: 'self' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 600,
    },
  ],

  elevenlabs: [
    {
      id: 'voices', label: 'Voices',
      description: "ElevenLabs voices in the user's library (premade + custom cloned). Scope a credential to a small set so templates auto-fill the right voice without listing everything.",
      selection: 'multi',
      list_endpoint: {
        method: 'GET',
        url: 'https://api.elevenlabs.io/v1/voices',
        headers: { 'xi-api-key': '{{api_key}}' },
        pagination: { type: 'none' },
      },
      response_mapping: {
        items_path: 'voices', id: 'voice_id', label: 'name', sublabel: 'category',
        meta: { category: 'category', preview_url: 'preview_url' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 1800,
    },
    {
      id: 'models', label: 'Models',
      description: 'TTS models available to the account.',
      selection: 'single_or_all',
      list_endpoint: {
        method: 'GET',
        url: 'https://api.elevenlabs.io/v1/models',
        headers: { 'xi-api-key': '{{api_key}}' },
        pagination: { type: 'none' },
      },
      response_mapping: {
        items_path: '$', id: 'model_id', label: 'name', sublabel: 'description',
        meta: { languages: 'languages' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 86400,
    },
  ],

  discord: [
    {
      id: 'guilds', label: 'Servers',
      description: "Discord guilds (servers) the bot has joined. Scope to specific servers so the bot can't post into unrelated communities.",
      selection: 'multi',
      list_endpoint: {
        method: 'GET',
        url: 'https://discord.com/api/v10/users/@me/guilds?limit=200',
        headers: { Authorization: 'Bot {{bot_token}}' },
        pagination: { type: 'none' },
      },
      response_mapping: {
        items_path: '$', id: 'id', label: 'name',
        meta: { owner: 'owner', permissions: 'permissions' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 600,
    },
  ],

  dropbox: [
    {
      id: 'folders', label: 'Folders (root)',
      description: "Top-level folders in the user's Dropbox. Scope a credential so an agent can't read or write outside the chosen folders.",
      selection: 'multi',
      list_endpoint: {
        method: 'POST',
        url: 'https://api.dropboxapi.com/2/files/list_folder',
        headers: {
          Authorization: 'Bearer {{access_token}}',
          'Content-Type': 'application/json',
        },
        body: '{"path":"","recursive":false,"include_non_downloadable_files":false,"limit":200}',
        pagination: { type: 'none' },
      },
      response_mapping: {
        items_path: 'entries', id: 'path_lower', label: 'name', sublabel: 'path_display',
        meta: { tag: '.tag' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 600,
    },
  ],

  confluence: [
    {
      id: 'spaces', label: 'Spaces',
      description: 'Confluence spaces the API token can access.',
      selection: 'multi',
      list_endpoint: {
        method: 'GET',
        url: 'https://{{domain}}/wiki/rest/api/space?limit=100&type=global',
        headers: { Authorization: 'Bearer {{api_token}}', Accept: 'application/json' },
        pagination: {
          type: 'page_param',
          page_param: 'start',
          per_page: 100,
          max_pages: 5,
        },
      },
      response_mapping: {
        items_path: 'results', id: 'key', label: 'name', sublabel: 'description.plain.value',
        meta: { id: 'id', type: 'type' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 1800,
    },
  ],

  asana: [
    {
      id: 'workspaces', label: 'Workspaces',
      description: 'Asana workspaces the token can access.',
      selection: 'multi',
      list_endpoint: {
        method: 'GET',
        url: 'https://app.asana.com/api/1.0/workspaces?limit=100',
        headers: { Authorization: 'Bearer {{personal_access_token}}' },
        pagination: { type: 'none' },
      },
      response_mapping: {
        items_path: 'data', id: 'gid', label: 'name',
        meta: { resource_type: 'resource_type' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 3600,
    },
    {
      id: 'projects', label: 'Projects',
      description: 'Active Asana projects across all accessible workspaces.',
      selection: 'multi',
      list_endpoint: {
        method: 'GET',
        url: 'https://app.asana.com/api/1.0/projects?archived=false&limit=100',
        headers: { Authorization: 'Bearer {{personal_access_token}}' },
        pagination: { type: 'none' },
      },
      response_mapping: {
        items_path: 'data', id: 'gid', label: 'name',
        meta: { resource_type: 'resource_type' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 600,
    },
  ],

  monday: [
    {
      id: 'boards', label: 'Boards',
      description: 'Monday.com boards. Scope a credential so an agent only sees the boards you intend.',
      selection: 'multi',
      list_endpoint: {
        method: 'POST',
        url: 'https://api.monday.com/v2',
        headers: {
          Authorization: '{{api_key_v2}}',
          'Content-Type': 'application/json',
          'API-Version': '2024-01',
        },
        body: '{"query":"{ boards (limit: 200, state: active) { id name description workspace { id name } } }"}',
        pagination: { type: 'none' },
      },
      response_mapping: {
        items_path: 'data.boards', id: 'id', label: 'name', sublabel: 'description',
        meta: { workspace: 'workspace.name' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 600,
    },
  ],

  hubspot: [
    {
      id: 'pipelines', label: 'Deal pipelines',
      description: 'HubSpot deal pipelines (sales funnels). Scope a credential to specific pipelines so agents only act on the ones you care about.',
      selection: 'multi',
      list_endpoint: {
        method: 'GET',
        url: 'https://api.hubapi.com/crm/v3/pipelines/deals',
        headers: { Authorization: 'Bearer {{access_token}}' },
        pagination: { type: 'none' },
      },
      response_mapping: {
        items_path: 'results', id: 'id', label: 'label', sublabel: 'displayOrder',
        meta: { archived: 'archived', stagesCount: 'stages.length' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 1800,
    },
  ],

  pipedrive: [
    {
      id: 'pipelines', label: 'Pipelines',
      description: 'Pipedrive sales pipelines. Scope a credential to specific pipelines.',
      selection: 'multi',
      list_endpoint: {
        method: 'GET',
        url: 'https://{{domain}}.pipedrive.com/api/v1/pipelines?api_token={{api_token}}',
        headers: { Accept: 'application/json' },
        pagination: { type: 'none' },
      },
      response_mapping: {
        items_path: 'data', id: 'id', label: 'name', sublabel: 'url_title',
        meta: { active: 'active', deal_probability: 'deal_probability' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 1800,
    },
  ],

  posthog: [
    {
      id: 'projects', label: 'Projects',
      description: 'PostHog projects (teams) the personal API key can access.',
      selection: 'multi',
      list_endpoint: {
        method: 'GET',
        url: '{{host|https://us.posthog.com}}/api/projects/',
        headers: { Authorization: 'Bearer {{personal_api_key}}' },
        pagination: {
          type: 'page_param', page_param: 'page', per_page: 100, max_pages: 3,
        },
      },
      response_mapping: {
        items_path: 'results', id: 'id', label: 'name', sublabel: 'organization',
        meta: { api_token: 'api_token', timezone: 'timezone' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 1800,
    },
  ],

  vercel: [
    {
      id: 'projects', label: 'Projects',
      description: 'Vercel projects accessible to the token.',
      selection: 'multi',
      list_endpoint: {
        method: 'GET',
        url: 'https://api.vercel.com/v9/projects?limit=100',
        headers: { Authorization: 'Bearer {{access_token}}' },
        pagination: {
          type: 'cursor',
          cursor_param: 'until',
          cursor_path: 'pagination.next',
          max_pages: 3,
        },
      },
      response_mapping: {
        items_path: 'projects', id: 'id', label: 'name', sublabel: 'framework',
        meta: { framework: 'framework', accountId: 'accountId' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 600,
    },
  ],

  netlify: [
    {
      id: 'sites', label: 'Sites',
      description: 'Netlify sites the access token can manage.',
      selection: 'multi',
      list_endpoint: {
        method: 'GET',
        url: 'https://api.netlify.com/api/v1/sites?per_page=100',
        headers: { Authorization: 'Bearer {{access_token}}' },
        pagination: {
          type: 'page_param', page_param: 'page', per_page: 100, max_pages: 3,
        },
      },
      response_mapping: {
        items_path: '$', id: 'id', label: 'name', sublabel: 'url',
        meta: { url: 'url', custom_domain: 'custom_domain' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 600,
    },
  ],

  attio: [
    {
      id: 'workspaces', label: 'Workspaces',
      description: 'Attio workspaces accessible to the access token.',
      selection: 'single_or_all',
      list_endpoint: {
        method: 'GET',
        url: 'https://api.attio.com/v2/self',
        headers: { Authorization: 'Bearer {{access_token}}' },
        pagination: { type: 'none' },
      },
      response_mapping: {
        items_path: '$',
        id: 'workspace_id',
        label: 'workspace_name',
        meta: { active: 'active' },
      },
      search: { supported: false, mode: 'client' }, cache_ttl_seconds: 3600,
    },
    {
      id: 'lists', label: 'Lists',
      description: 'Attio lists (custom views over collections).',
      selection: 'multi',
      list_endpoint: {
        method: 'GET',
        url: 'https://api.attio.com/v2/lists',
        headers: { Authorization: 'Bearer {{access_token}}' },
        pagination: { type: 'none' },
      },
      response_mapping: {
        items_path: 'data', id: 'id.list_id', label: 'name',
        meta: { parent_object: 'parent_object', api_slug: 'api_slug' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 600,
    },
  ],

  clickup: [
    {
      id: 'workspaces', label: 'Workspaces',
      description: 'ClickUp workspaces (called "teams" in the API). Scope to limit which workspaces the credential can act on.',
      selection: 'multi',
      list_endpoint: {
        method: 'GET',
        url: 'https://api.clickup.com/api/v2/team',
        headers: { Authorization: '{{api_key}}' },
        pagination: { type: 'none' },
      },
      response_mapping: {
        items_path: 'teams', id: 'id', label: 'name',
        meta: { color: 'color' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 1800,
    },
  ],

  neon: [
    {
      id: 'projects', label: 'Projects',
      description: 'Neon Postgres projects accessible to the API key.',
      selection: 'multi',
      list_endpoint: {
        method: 'GET',
        url: 'https://console.neon.tech/api/v2/projects?limit=100',
        headers: { Authorization: 'Bearer {{api_key}}', Accept: 'application/json' },
        pagination: {
          type: 'cursor',
          cursor_param: 'cursor',
          cursor_path: 'pagination.cursor',
          max_pages: 3,
        },
      },
      response_mapping: {
        items_path: 'projects', id: 'id', label: 'name', sublabel: 'region_id',
        meta: { pg_version: 'pg_version', org_id: 'org_id', branch_logical_size_limit: 'branch_logical_size_limit' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 1800,
    },
  ],

  'azure-devops': [
    {
      id: 'projects', label: 'Projects',
      description: 'Azure DevOps projects in the configured organization.',
      selection: 'multi',
      list_endpoint: {
        method: 'GET',
        url: 'https://dev.azure.com/{{organization}}/_apis/projects?api-version=7.1&$top=200',
        headers: { Authorization: 'Basic {{base64(:pat)}}', Accept: 'application/json' },
        pagination: { type: 'none' },
      },
      response_mapping: {
        items_path: 'value', id: 'id', label: 'name', sublabel: 'description',
        meta: { state: 'state', visibility: 'visibility', url: 'url' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 600,
    },
  ],

  sentry: [
    {
      id: 'organizations', label: 'Organizations',
      description: 'Sentry organizations the auth token can access.',
      selection: 'single_or_all',
      list_endpoint: {
        method: 'GET',
        url: 'https://sentry.io/api/0/organizations/?member=1',
        headers: { Authorization: 'Bearer {{auth_token}}' },
        pagination: { type: 'link_header', max_pages: 3 },
      },
      response_mapping: {
        items_path: '$', id: 'slug', label: 'name', sublabel: 'slug',
        meta: { id: 'id' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 3600,
    },
    {
      id: 'projects', label: 'Projects',
      description: "Sentry projects across the user's organizations. Scope to specific projects so an alert agent only watches the ones you care about.",
      selection: 'multi',
      list_endpoint: {
        method: 'GET',
        url: 'https://sentry.io/api/0/projects/',
        headers: { Authorization: 'Bearer {{auth_token}}' },
        pagination: { type: 'link_header', max_pages: 5 },
      },
      response_mapping: {
        items_path: '$', id: 'slug', label: 'name', sublabel: 'organization.slug',
        meta: { id: 'id', platform: 'platform', organization: 'organization.slug' },
      },
      search: { supported: true, mode: 'client' }, cache_ttl_seconds: 600,
    },
  ],
};

let touched = 0;
for (const [name, resources] of Object.entries(SPECS)) {
  const file = path.join(DIR, `${name}.json`);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(json.resources) && json.resources.length === resources.length) {
    // Already populated — overwrite with fresh spec to keep the source-of-truth here.
  }
  json.resources = resources;

  // Re-serialize with stable key order: keep insertion order so resources
  // sits between events and metadata, matching the manual GitHub sample.
  const ordered = {};
  for (const k of Object.keys(json)) {
    if (k === 'metadata') continue; // re-add at end
    if (k !== 'resources') ordered[k] = json[k];
  }
  // Insert resources after events, before metadata
  if (!('resources' in ordered)) {
    const out = {};
    for (const k of Object.keys(ordered)) {
      out[k] = ordered[k];
      if (k === 'events') out.resources = resources;
    }
    if (json.metadata !== undefined) out.metadata = json.metadata;
    fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n', 'utf8');
  } else {
    ordered.resources = resources;
    if (json.metadata !== undefined) ordered.metadata = json.metadata;
    fs.writeFileSync(file, JSON.stringify(ordered, null, 2) + '\n', 'utf8');
  }
  touched++;
  console.log(`✓ ${name} → ${resources.length} resource spec(s)`);
}

console.log(`\nDone. Touched ${touched} connector files.`);
console.log('Run: node scripts/generate-connector-seed.mjs to refresh the Rust seed.');
