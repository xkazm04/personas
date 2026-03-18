import type { ApiEndpoint } from '@/api/system/apiProxy';

// -- Catalog-bundled API endpoints ------------------------------------
// Curated 5-10 most useful endpoints per connector, sourced from
// official OpenAPI specs. These are merged with user-uploaded specs
// in the API Explorer tab.

type EP = ApiEndpoint;

const p = (name: string, location: string, required: boolean, schema_type: string | null = 'string', description: string | null = null) =>
  ({ name, location, required, schema_type, description });

const pathP = (name: string, desc: string | null = null) => p(name, 'path', true, 'string', desc);
const queryP = (name: string, required = false, desc: string | null = null) => p(name, 'query', required, 'string', desc);

const ep = (method: string, path: string, summary: string, params: EP['parameters'] = [], tags: string[] = [], request_body: EP['request_body'] = null, description: string | null = null): EP =>
  ({ method, path, summary, description, parameters: params, request_body, tags });

const jsonBody = (required = true): EP['request_body'] =>
  ({ content_type: 'application/json', schema_json: null, required });

// -- Azure DevOps ----------------------------------------------------

const azure_devops: EP[] = [
  ep('GET', '/_apis/projects', 'List projects', [
    queryP('api-version', true, '7.1'),
  ], ['Projects']),
  ep('GET', '/{project}/_apis/wit/workitems/{id}', 'Get work item', [
    pathP('project', 'Project name or ID'),
    pathP('id', 'Work item ID'),
    queryP('api-version', true, '7.1'),
  ], ['Work Items']),
  ep('GET', '/{project}/_apis/git/repositories', 'List repositories', [
    pathP('project'),
    queryP('api-version', true, '7.1'),
  ], ['Git']),
  ep('GET', '/{project}/_apis/git/repositories/{repositoryId}/pullrequests', 'List pull requests', [
    pathP('project'), pathP('repositoryId'),
    queryP('api-version', true, '7.1'),
    queryP('searchCriteria.status', false, 'active, completed, abandoned, all'),
  ], ['Git']),
  ep('GET', '/{project}/_apis/build/builds', 'List builds', [
    pathP('project'),
    queryP('api-version', true, '7.1'),
  ], ['Build']),
  ep('GET', '/{project}/_apis/pipelines', 'List pipelines', [
    pathP('project'),
    queryP('api-version', true, '7.1'),
  ], ['Pipelines']),
  ep('POST', '/{project}/_apis/wit/workitems/$Task', 'Create work item', [
    pathP('project'),
    queryP('api-version', true, '7.1'),
  ], ['Work Items'], jsonBody(), 'Body: [{ "op": "add", "path": "/fields/System.Title", "value": "..." }]'),
];

// -- GitHub -----------------------------------------------------------

const github: EP[] = [
  ep('GET', '/user', 'Get authenticated user', [], ['Users']),
  ep('GET', '/user/repos', 'List repositories for authenticated user', [
    queryP('sort', false, 'created, updated, pushed, full_name'),
    queryP('per_page', false, 'Results per page (max 100)'),
  ], ['Repos']),
  ep('GET', '/repos/{owner}/{repo}', 'Get a repository', [
    pathP('owner'), pathP('repo'),
  ], ['Repos']),
  ep('GET', '/repos/{owner}/{repo}/issues', 'List issues', [
    pathP('owner'), pathP('repo'),
    queryP('state', false, 'open, closed, all'),
    queryP('per_page'),
  ], ['Issues']),
  ep('POST', '/repos/{owner}/{repo}/issues', 'Create an issue', [
    pathP('owner'), pathP('repo'),
  ], ['Issues'], jsonBody(), 'Body: { "title": "...", "body": "...", "labels": [] }'),
  ep('GET', '/repos/{owner}/{repo}/pulls', 'List pull requests', [
    pathP('owner'), pathP('repo'),
    queryP('state', false, 'open, closed, all'),
  ], ['Pull Requests']),
  ep('GET', '/repos/{owner}/{repo}/commits', 'List commits', [
    pathP('owner'), pathP('repo'),
    queryP('per_page'),
  ], ['Commits']),
  ep('GET', '/repos/{owner}/{repo}/actions/runs', 'List workflow runs', [
    pathP('owner'), pathP('repo'),
  ], ['Actions']),
];

// -- GitLab ---------------------------------------------------------------

const gitlab: EP[] = [
  ep('GET', '/user', 'Get authenticated user', [], ['Users']),
  ep('GET', '/projects', 'List projects accessible by the authenticated user', [
    queryP('membership', false, 'true to limit to member projects'),
    queryP('per_page', false, 'Results per page (max 100)'),
  ], ['Projects']),
  ep('GET', '/projects/{id}', 'Get a single project', [
    pathP('id', 'Project ID or URL-encoded path'),
  ], ['Projects']),
  ep('GET', '/projects/{id}/issues', 'List project issues', [
    pathP('id', 'Project ID or URL-encoded path'),
    queryP('state', false, 'opened, closed, all'),
    queryP('per_page'),
  ], ['Issues']),
  ep('GET', '/projects/{id}/merge_requests', 'List merge requests', [
    pathP('id', 'Project ID or URL-encoded path'),
    queryP('state', false, 'opened, closed, merged, all'),
    queryP('per_page'),
  ], ['Merge Requests']),
  ep('GET', '/projects/{id}/pipelines', 'List project pipelines', [
    pathP('id', 'Project ID or URL-encoded path'),
    queryP('per_page'),
  ], ['CI/CD']),
  ep('GET', '/projects/{id}/repository/branches', 'List branches', [
    pathP('id', 'Project ID or URL-encoded path'),
  ], ['Repositories']),
  ep('POST', '/projects/{id}/issues', 'Create an issue', [
    pathP('id', 'Project ID or URL-encoded path'),
  ], ['Issues'], jsonBody(), 'Body: { "title": "...", "description": "...", "labels": "..." }'),
];

// -- Slack ------------------------------------------------------------

const slack: EP[] = [
  ep('POST', '/chat.postMessage', 'Send a message to a channel', [], ['Chat'], jsonBody(), 'Body: { "channel": "C01...", "text": "Hello!" }'),
  ep('GET', '/conversations.list', 'List channels', [
    queryP('types', false, 'public_channel, private_channel, mpim, im'),
    queryP('limit', false, 'Max items (default 100)'),
  ], ['Conversations']),
  ep('GET', '/conversations.history', 'Get messages from a channel', [
    queryP('channel', true, 'Channel ID'),
    queryP('limit', false, 'Max messages'),
  ], ['Conversations']),
  ep('GET', '/users.list', 'List workspace users', [
    queryP('limit'),
  ], ['Users']),
  ep('GET', '/users.info', 'Get user info', [
    queryP('user', true, 'User ID'),
  ], ['Users']),
  ep('POST', '/conversations.create', 'Create a channel', [], ['Conversations'], jsonBody(), 'Body: { "name": "new-channel" }'),
  ep('POST', '/reactions.add', 'Add a reaction', [], ['Reactions'], jsonBody(), 'Body: { "channel": "C01...", "name": "thumbsup", "timestamp": "..." }'),
];

// -- Discord ----------------------------------------------------------

const discord: EP[] = [
  ep('GET', '/users/@me', 'Get current user', [], ['Users']),
  ep('GET', '/users/@me/guilds', 'List current user guilds', [], ['Users']),
  ep('GET', '/guilds/{guild_id}/channels', 'List guild channels', [
    pathP('guild_id'),
  ], ['Guilds']),
  ep('POST', '/channels/{channel_id}/messages', 'Create message', [
    pathP('channel_id'),
  ], ['Messages'], jsonBody(), 'Body: { "content": "Hello!" }'),
  ep('GET', '/channels/{channel_id}/messages', 'Get channel messages', [
    pathP('channel_id'),
    queryP('limit', false, 'Max messages (1-100)'),
  ], ['Messages']),
  ep('GET', '/guilds/{guild_id}/members', 'List guild members', [
    pathP('guild_id'),
    queryP('limit', false, 'Max members (1-1000)'),
  ], ['Members']),
];

// -- Cloudflare -------------------------------------------------------

const cloudflare: EP[] = [
  ep('GET', '/user/tokens/verify', 'Verify API token', [], ['User']),
  ep('GET', '/zones', 'List zones', [
    queryP('name', false, 'Zone name filter'),
    queryP('per_page', false, 'Results per page'),
  ], ['Zones']),
  ep('GET', '/zones/{zone_id}/dns_records', 'List DNS records', [
    pathP('zone_id'),
    queryP('type', false, 'DNS record type (A, CNAME, etc.)'),
  ], ['DNS']),
  ep('POST', '/zones/{zone_id}/dns_records', 'Create DNS record', [
    pathP('zone_id'),
  ], ['DNS'], jsonBody(), 'Body: { "type": "A", "name": "example.com", "content": "1.2.3.4" }'),
  ep('GET', '/accounts', 'List accounts', [], ['Accounts']),
  ep('GET', '/zones/{zone_id}/analytics/dashboard', 'Get zone analytics', [
    pathP('zone_id'),
  ], ['Analytics']),
];

// -- Vercel -----------------------------------------------------------

const vercel: EP[] = [
  ep('GET', '/v2/user', 'Get current user', [], ['User']),
  ep('GET', '/v9/projects', 'List projects', [
    queryP('limit'),
  ], ['Projects']),
  ep('GET', '/v13/deployments', 'List deployments', [
    queryP('projectId', false, 'Filter by project'),
    queryP('limit'),
  ], ['Deployments']),
  ep('GET', '/v9/projects/{idOrName}', 'Get project', [
    pathP('idOrName', 'Project ID or name'),
  ], ['Projects']),
  ep('GET', '/v5/domains', 'List domains', [], ['Domains']),
  ep('GET', '/v1/edge-config', 'List edge configs', [], ['Edge Config']),
];

// -- Netlify ----------------------------------------------------------

const netlify: EP[] = [
  ep('GET', '/api/v1/user', 'Get current user', [], ['User']),
  ep('GET', '/api/v1/sites', 'List sites', [], ['Sites']),
  ep('GET', '/api/v1/sites/{site_id}', 'Get site', [
    pathP('site_id'),
  ], ['Sites']),
  ep('GET', '/api/v1/sites/{site_id}/deploys', 'List deploys', [
    pathP('site_id'),
  ], ['Deploys']),
  ep('GET', '/api/v1/sites/{site_id}/forms', 'List forms', [
    pathP('site_id'),
  ], ['Forms']),
  ep('GET', '/api/v1/{account_slug}/builds', 'List builds', [
    pathP('account_slug'),
  ], ['Builds']),
];

// -- HubSpot ----------------------------------------------------------

const hubspot: EP[] = [
  ep('GET', '/crm/v3/objects/contacts', 'List contacts', [
    queryP('limit', false, 'Max results'),
    queryP('properties', false, 'Comma-separated properties'),
  ], ['CRM']),
  ep('POST', '/crm/v3/objects/contacts', 'Create contact', [], ['CRM'], jsonBody(), 'Body: { "properties": { "email": "...", "firstname": "..." } }'),
  ep('GET', '/crm/v3/objects/deals', 'List deals', [
    queryP('limit'),
  ], ['CRM']),
  ep('POST', '/crm/v3/objects/deals', 'Create deal', [], ['CRM'], jsonBody(), 'Body: { "properties": { "dealname": "...", "amount": "..." } }'),
  ep('GET', '/crm/v3/objects/companies', 'List companies', [
    queryP('limit'),
  ], ['CRM']),
  ep('GET', '/crm/v3/owners', 'List owners', [], ['CRM']),
  ep('POST', '/crm/v3/objects/contacts/search', 'Search contacts', [], ['CRM'], jsonBody(), 'Body: { "filterGroups": [...], "limit": 10 }'),
];

// -- Sentry -----------------------------------------------------------

const sentry: EP[] = [
  ep('GET', '/organizations/{organization_slug}/', 'Get organization', [
    pathP('organization_slug'),
  ], ['Organizations']),
  ep('GET', '/organizations/{organization_slug}/projects/', 'List projects', [
    pathP('organization_slug'),
  ], ['Projects']),
  ep('GET', '/projects/{organization_slug}/{project_slug}/issues/', 'List issues', [
    pathP('organization_slug'), pathP('project_slug'),
    queryP('query', false, 'Search query'),
  ], ['Issues']),
  ep('GET', '/organizations/{organization_slug}/events/', 'List events', [
    pathP('organization_slug'),
  ], ['Events']),
  ep('PUT', '/organizations/{organization_slug}/issues/{issue_id}/', 'Update issue', [
    pathP('organization_slug'), pathP('issue_id'),
  ], ['Issues'], jsonBody(), 'Body: { "status": "resolved" }'),
  ep('GET', '/projects/{organization_slug}/{project_slug}/stats/', 'Get project stats', [
    pathP('organization_slug'), pathP('project_slug'),
  ], ['Projects']),
];

// -- PostHog ----------------------------------------------------------

const posthog: EP[] = [
  ep('GET', '/api/projects/', 'List projects', [], ['Projects']),
  ep('GET', '/api/projects/{id}/events/', 'List events', [
    pathP('id', 'Project ID'),
    queryP('limit'),
  ], ['Events']),
  ep('POST', '/api/projects/{id}/query/', 'Run HogQL query', [
    pathP('id', 'Project ID'),
  ], ['Query'], jsonBody(), 'Body: { "query": { "kind": "HogQLQuery", "query": "SELECT ..." } }'),
  ep('GET', '/api/projects/{id}/feature_flags/', 'List feature flags', [
    pathP('id', 'Project ID'),
  ], ['Feature Flags']),
  ep('GET', '/api/projects/{id}/insights/', 'List insights', [
    pathP('id', 'Project ID'),
  ], ['Insights']),
  ep('GET', '/api/projects/{id}/persons/', 'List persons', [
    pathP('id', 'Project ID'),
  ], ['Persons']),
];

// -- SendGrid ---------------------------------------------------------

const sendgrid: EP[] = [
  ep('POST', '/v3/mail/send', 'Send email', [], ['Mail'], jsonBody(), 'Body: { "personalizations": [{"to":[{"email":"..."}]}], "from":{"email":"..."}, "subject":"...", "content":[{"type":"text/plain","value":"..."}] }'),
  ep('GET', '/v3/scopes', 'List access scopes', [], ['Auth']),
  ep('GET', '/v3/templates', 'List templates', [
    queryP('generations', false, 'legacy or dynamic'),
  ], ['Templates']),
  ep('GET', '/v3/marketing/contacts', 'List marketing contacts', [], ['Marketing']),
  ep('GET', '/v3/stats', 'Get global send stats', [
    queryP('start_date', true, 'YYYY-MM-DD'),
  ], ['Stats']),
  ep('GET', '/v3/suppression/bounces', 'List bounces', [], ['Suppressions']),
];

// -- Twilio SMS -------------------------------------------------------

const twilio_sms: EP[] = [
  ep('POST', '/2010-04-01/Accounts/{AccountSid}/Messages.json', 'Send SMS', [
    pathP('AccountSid'),
  ], ['Messages'], jsonBody(), 'Body (form): To=+1234567890&From=+0987654321&Body=Hello'),
  ep('GET', '/2010-04-01/Accounts/{AccountSid}/Messages.json', 'List messages', [
    pathP('AccountSid'),
    queryP('PageSize', false, 'Results per page'),
  ], ['Messages']),
  ep('GET', '/2010-04-01/Accounts/{AccountSid}/Messages/{MessageSid}.json', 'Get message', [
    pathP('AccountSid'), pathP('MessageSid'),
  ], ['Messages']),
  ep('GET', '/2010-04-01/Accounts/{AccountSid}.json', 'Get account', [
    pathP('AccountSid'),
  ], ['Account']),
  ep('GET', '/2010-04-01/Accounts/{AccountSid}/IncomingPhoneNumbers.json', 'List phone numbers', [
    pathP('AccountSid'),
  ], ['Phone Numbers']),
];

// -- Jira -------------------------------------------------------------

const jira: EP[] = [
  ep('GET', '/rest/api/3/myself', 'Get current user', [], ['Users']),
  ep('GET', '/rest/api/3/search', 'Search issues (JQL)', [
    queryP('jql', true, 'JQL query string'),
    queryP('maxResults', false, 'Max results'),
  ], ['Search']),
  ep('POST', '/rest/api/3/issue', 'Create issue', [], ['Issues'], jsonBody(), 'Body: { "fields": { "project": {"key":"PROJ"}, "summary": "...", "issuetype": {"name":"Task"} } }'),
  ep('GET', '/rest/api/3/issue/{issueIdOrKey}', 'Get issue', [
    pathP('issueIdOrKey'),
  ], ['Issues']),
  ep('PUT', '/rest/api/3/issue/{issueIdOrKey}', 'Update issue', [
    pathP('issueIdOrKey'),
  ], ['Issues'], jsonBody(), 'Body: { "fields": { "summary": "Updated" } }'),
  ep('GET', '/rest/api/3/project', 'List projects', [], ['Projects']),
  ep('GET', '/rest/api/3/issue/{issueIdOrKey}/transitions', 'Get transitions', [
    pathP('issueIdOrKey'),
  ], ['Issues']),
];

// -- Confluence -------------------------------------------------------

const confluence: EP[] = [
  ep('GET', '/wiki/rest/api/space', 'List spaces', [
    queryP('limit'),
  ], ['Spaces']),
  ep('GET', '/wiki/rest/api/content', 'List content', [
    queryP('spaceKey', false, 'Space key filter'),
    queryP('type', false, 'page or blogpost'),
  ], ['Content']),
  ep('POST', '/wiki/rest/api/content', 'Create content', [], ['Content'], jsonBody(), 'Body: { "type": "page", "title": "...", "space": {"key":"..."}, "body": {"storage":{"value":"...","representation":"storage"}} }'),
  ep('GET', '/wiki/rest/api/content/{id}', 'Get content by ID', [
    pathP('id'),
    queryP('expand', false, 'body.storage, version, etc.'),
  ], ['Content']),
  ep('GET', '/wiki/rest/api/search', 'Search content (CQL)', [
    queryP('cql', true, 'CQL query string'),
  ], ['Search']),
  ep('GET', '/wiki/rest/api/content/{id}/child/page', 'List child pages', [
    pathP('id'),
  ], ['Content']),
];

// -- CircleCI ---------------------------------------------------------

const circleci: EP[] = [
  ep('GET', '/me', 'Get current user', [], ['User']),
  ep('GET', '/project/{project-slug}/pipeline', 'List pipelines', [
    pathP('project-slug', 'e.g. gh/owner/repo'),
  ], ['Pipelines']),
  ep('POST', '/project/{project-slug}/pipeline', 'Trigger pipeline', [
    pathP('project-slug'),
  ], ['Pipelines'], jsonBody(), 'Body: { "branch": "main", "parameters": {} }'),
  ep('GET', '/pipeline/{pipeline-id}/workflow', 'List workflows', [
    pathP('pipeline-id'),
  ], ['Workflows']),
  ep('GET', '/workflow/{id}/job', 'List jobs in workflow', [
    pathP('id', 'Workflow ID'),
  ], ['Jobs']),
  ep('GET', '/project/{project-slug}', 'Get project', [
    pathP('project-slug'),
  ], ['Projects']),
];

// -- Figma ------------------------------------------------------------

const figma: EP[] = [
  ep('GET', '/v1/me', 'Get current user', [], ['Users']),
  ep('GET', '/v1/files/{key}', 'Get file', [
    pathP('key', 'File key'),
  ], ['Files']),
  ep('GET', '/v1/files/{key}/comments', 'List comments', [
    pathP('key', 'File key'),
  ], ['Comments']),
  ep('POST', '/v1/files/{key}/comments', 'Post comment', [
    pathP('key', 'File key'),
  ], ['Comments'], jsonBody(), 'Body: { "message": "...", "client_meta": {"x":0,"y":0} }'),
  ep('GET', '/v1/images/{key}', 'Export images', [
    pathP('key', 'File key'),
    queryP('ids', true, 'Comma-separated node IDs'),
    queryP('format', false, 'jpg, png, svg, pdf'),
  ], ['Images']),
  ep('GET', '/v1/teams/{team_id}/projects', 'List team projects', [
    pathP('team_id'),
  ], ['Teams']),
  ep('GET', '/v1/projects/{project_id}/files', 'List project files', [
    pathP('project_id'),
  ], ['Projects']),
];

// -- Supabase ---------------------------------------------------------

const supabase: EP[] = [
  ep('GET', '/v1/projects', 'List projects', [], ['Projects']),
  ep('POST', '/v1/projects', 'Create project', [], ['Projects'], jsonBody(), 'Body: { "name": "...", "organization_id": "...", "db_pass": "...", "region": "us-east-1" }'),
  ep('GET', '/v1/projects/{ref}', 'Get project', [
    pathP('ref', 'Project reference ID'),
  ], ['Projects']),
  ep('GET', '/v1/projects/{ref}/functions', 'List edge functions', [
    pathP('ref'),
  ], ['Functions']),
  ep('GET', '/v1/organizations', 'List organizations', [], ['Organizations']),
  ep('GET', '/v1/projects/{ref}/api-keys', 'Get API keys', [
    pathP('ref'),
  ], ['Projects']),
];

// -- Neon -------------------------------------------------------------

const neon: EP[] = [
  ep('GET', '/projects', 'List projects', [], ['Projects']),
  ep('POST', '/projects', 'Create project', [], ['Projects'], jsonBody(), 'Body: { "project": { "name": "...", "region_id": "aws-us-east-1" } }'),
  ep('GET', '/projects/{project_id}', 'Get project', [
    pathP('project_id'),
  ], ['Projects']),
  ep('GET', '/projects/{project_id}/branches', 'List branches', [
    pathP('project_id'),
  ], ['Branches']),
  ep('POST', '/projects/{project_id}/branches', 'Create branch', [
    pathP('project_id'),
  ], ['Branches'], jsonBody(), 'Body: { "branch": { "name": "dev" }, "endpoints": [{"type":"read_write"}] }'),
  ep('GET', '/projects/{project_id}/endpoints', 'List endpoints', [
    pathP('project_id'),
  ], ['Endpoints']),
  ep('GET', '/projects/{project_id}/databases', 'List databases', [
    pathP('project_id'),
    pathP('branch_id'),
  ], ['Databases']),
];

// -- ClickUp ----------------------------------------------------------

const clickup: EP[] = [
  ep('GET', '/user', 'Get current user', [], ['User']),
  ep('GET', '/team', 'List workspaces', [], ['Teams']),
  ep('GET', '/team/{team_id}/space', 'List spaces', [
    pathP('team_id'),
  ], ['Spaces']),
  ep('GET', '/space/{space_id}/list', 'List lists in space', [
    pathP('space_id'),
  ], ['Lists']),
  ep('GET', '/list/{list_id}/task', 'List tasks', [
    pathP('list_id'),
  ], ['Tasks']),
  ep('POST', '/list/{list_id}/task', 'Create task', [
    pathP('list_id'),
  ], ['Tasks'], jsonBody(), 'Body: { "name": "...", "description": "..." }'),
  ep('GET', '/task/{task_id}', 'Get task', [
    pathP('task_id'),
  ], ['Tasks']),
];

// -- Resend -----------------------------------------------------------

const resend: EP[] = [
  ep('POST', '/emails', 'Send email', [], ['Emails'], jsonBody(), 'Body: { "from": "you@example.com", "to": ["user@example.com"], "subject": "...", "html": "<p>...</p>" }'),
  ep('GET', '/emails/{email_id}', 'Get email', [
    pathP('email_id'),
  ], ['Emails']),
  ep('GET', '/domains', 'List domains', [], ['Domains']),
  ep('POST', '/domains', 'Add domain', [], ['Domains'], jsonBody(), 'Body: { "name": "example.com" }'),
  ep('GET', '/api-keys', 'List API keys', [], ['API Keys']),
  ep('GET', '/audiences', 'List audiences', [], ['Audiences']),
];

// -- Mixpanel ---------------------------------------------------------

const mixpanel: EP[] = [
  ep('GET', '/app/me', 'Get current user (service account)', [], ['Auth']),
  ep('POST', '/import', 'Import events', [
    queryP('project_id', true, 'Project ID'),
  ], ['Ingestion'], jsonBody(), 'Body: [{ "event": "...", "properties": { "distinct_id": "...", "time": 123 } }]'),
  ep('POST', '/engage#profile-set', 'Set user profile', [
    queryP('project_id', true),
  ], ['Profiles'], jsonBody(), 'Body: [{ "$distinct_id": "...", "$set": { "name": "..." } }]'),
  ep('GET', '/api/2.0/export', 'Export raw events', [
    queryP('from_date', true, 'YYYY-MM-DD'),
    queryP('to_date', true, 'YYYY-MM-DD'),
    queryP('project_id', true),
  ], ['Export']),
  ep('GET', '/api/2.0/engage', 'Query user profiles', [
    queryP('project_id', true),
  ], ['Profiles']),
];

// -- Twilio Segment ---------------------------------------------------

const twilio_segment: EP[] = [
  ep('GET', '/sources', 'List sources', [], ['Sources']),
  ep('GET', '/sources/{sourceId}', 'Get source', [
    pathP('sourceId'),
  ], ['Sources']),
  ep('GET', '/destinations', 'List destinations', [], ['Destinations']),
  ep('GET', '/catalog/sources', 'List source catalog', [], ['Catalog']),
  ep('GET', '/catalog/destinations', 'List destination catalog', [], ['Catalog']),
  ep('GET', '/spaces', 'List spaces', [], ['Spaces']),
];

// -- PlanetScale ------------------------------------------------------

const planetscale: EP[] = [
  ep('GET', '/v1/organizations', 'List organizations', [], ['Organizations']),
  ep('GET', '/v1/organizations/{name}/databases', 'List databases', [
    pathP('name', 'Organization name'),
  ], ['Databases']),
  ep('GET', '/v1/organizations/{name}/databases/{db_name}/branches', 'List branches', [
    pathP('name'), pathP('db_name'),
  ], ['Branches']),
  ep('POST', '/v1/organizations/{name}/databases/{db_name}/branches', 'Create branch', [
    pathP('name'), pathP('db_name'),
  ], ['Branches'], jsonBody(), 'Body: { "name": "feature-branch", "parent_branch": "main" }'),
  ep('GET', '/v1/organizations/{name}/databases/{db_name}/deploy-requests', 'List deploy requests', [
    pathP('name'), pathP('db_name'),
  ], ['Deploy Requests']),
];

// -- Notion (community spec) -----------------------------------------

const notion: EP[] = [
  ep('GET', '/v1/users/me', 'Get current user', [], ['Users']),
  ep('POST', '/v1/search', 'Search pages and databases', [], ['Search'], jsonBody(), 'Body: { "query": "...", "filter": { "property": "object", "value": "page" } }'),
  ep('POST', '/v1/databases/{database_id}/query', 'Query database', [
    pathP('database_id'),
  ], ['Databases'], jsonBody(), 'Body: { "filter": {...}, "sorts": [...] }'),
  ep('POST', '/v1/pages', 'Create page', [], ['Pages'], jsonBody(), 'Body: { "parent": {"database_id":"..."}, "properties": {...} }'),
  ep('GET', '/v1/pages/{page_id}', 'Get page', [
    pathP('page_id'),
  ], ['Pages']),
  ep('PATCH', '/v1/pages/{page_id}', 'Update page', [
    pathP('page_id'),
  ], ['Pages'], jsonBody(), 'Body: { "properties": {...} }'),
  ep('GET', '/v1/blocks/{block_id}/children', 'List block children', [
    pathP('block_id'),
  ], ['Blocks']),
];

// -- Cal.com ----------------------------------------------------------

const cal_com: EP[] = [
  ep('GET', '/v2/me', 'Get current user profile', [], ['Users']),
  ep('GET', '/v2/bookings', 'List bookings', [
    queryP('status', false, 'upcoming, recurring, past, cancelled, unconfirmed'),
  ], ['Bookings']),
  ep('GET', '/v2/bookings/{bookingUid}', 'Get booking by UID', [
    pathP('bookingUid', 'Booking UID'),
  ], ['Bookings']),
  ep('POST', '/v2/bookings', 'Create a booking', [], ['Bookings'], jsonBody(), 'Body: { "start": "2025-01-01T10:00:00Z", "eventTypeId": 123, "attendee": { "name": "...", "email": "..." } }'),
  ep('GET', '/v2/event-types', 'List event types', [], ['Event Types']),
  ep('GET', '/v2/event-types/{eventTypeId}', 'Get event type by ID', [
    pathP('eventTypeId', 'Event type ID'),
  ], ['Event Types']),
  ep('GET', '/v2/schedules', 'List schedules', [], ['Schedules']),
  ep('GET', '/v2/calendars/busy-times', 'Check calendar availability', [
    queryP('dateFrom', true, 'ISO 8601 start'),
    queryP('dateTo', true, 'ISO 8601 end'),
  ], ['Availability']),
];

// -- Calendly (community spec) ----------------------------------------

const calendly: EP[] = [
  ep('GET', '/users/me', 'Get current user', [], ['Users']),
  ep('GET', '/event_types', 'List event types', [
    queryP('user', true, 'User URI'),
  ], ['Event Types']),
  ep('GET', '/scheduled_events', 'List scheduled events', [
    queryP('user', true, 'User URI'),
    queryP('min_start_time', false, 'ISO 8601'),
    queryP('max_start_time', false, 'ISO 8601'),
  ], ['Events']),
  ep('GET', '/scheduled_events/{uuid}/invitees', 'List invitees', [
    pathP('uuid', 'Event UUID'),
  ], ['Events']),
  ep('GET', '/organizations/{uuid}/memberships', 'List org memberships', [
    pathP('uuid', 'Organization UUID'),
  ], ['Organizations']),
];

// -- Telegram Bot API (community spec) --------------------------------

const telegram: EP[] = [
  ep('POST', '/getMe', 'Get bot info', [], ['Bot']),
  ep('POST', '/sendMessage', 'Send message', [], ['Messages'], jsonBody(), 'Body: { "chat_id": 123, "text": "Hello!" }'),
  ep('POST', '/getUpdates', 'Get updates (long polling)', [], ['Updates'], jsonBody(), 'Body: { "offset": 0, "limit": 100, "timeout": 30 }'),
  ep('POST', '/sendPhoto', 'Send photo', [], ['Messages'], jsonBody(), 'Body: { "chat_id": 123, "photo": "https://..." }'),
  ep('POST', '/getChat', 'Get chat info', [], ['Chat'], jsonBody(), 'Body: { "chat_id": 123 }'),
  ep('POST', '/getChatMemberCount', 'Get member count', [], ['Chat'], jsonBody(), 'Body: { "chat_id": 123 }'),
];

// -- Buffer (community spec) -----------------------------------------

const buffer: EP[] = [
  ep('GET', '/1/user.json', 'Get user', [], ['User']),
  ep('GET', '/1/profiles.json', 'List profiles', [], ['Profiles']),
  ep('GET', '/1/profiles/{id}/updates/pending.json', 'List pending updates', [
    pathP('id', 'Profile ID'),
  ], ['Updates']),
  ep('POST', '/1/updates/create.json', 'Create update', [], ['Updates'], jsonBody(), 'Body: { "text": "...", "profile_ids": ["..."] }'),
  ep('GET', '/1/profiles/{id}/schedules.json', 'Get posting schedule', [
    pathP('id', 'Profile ID'),
  ], ['Schedules']),
];

// -- Airtable (Web API) ----------------------------------------------

const airtable: EP[] = [
  ep('GET', '/v0/meta/whoami', 'Get current user info', [], ['Auth']),
  ep('GET', '/v0/meta/bases', 'List bases', [], ['Bases']),
  ep('GET', '/v0/meta/bases/{baseId}/tables', 'List tables in a base', [
    pathP('baseId', 'Base ID (appXXX)'),
  ], ['Bases']),
  ep('GET', '/v0/{baseId}/{tableIdOrName}', 'List records', [
    pathP('baseId', 'Base ID (appXXX)'),
    pathP('tableIdOrName', 'Table ID or name'),
    queryP('maxRecords', false, 'Max records to return'),
    queryP('view', false, 'View name or ID'),
    queryP('filterByFormula', false, 'Airtable formula filter'),
  ], ['Records']),
  ep('POST', '/v0/{baseId}/{tableIdOrName}', 'Create records', [
    pathP('baseId'), pathP('tableIdOrName'),
  ], ['Records'], jsonBody(), 'Body: { "records": [{ "fields": { "Name": "..." } }] }'),
  ep('PATCH', '/v0/{baseId}/{tableIdOrName}', 'Update records', [
    pathP('baseId'), pathP('tableIdOrName'),
  ], ['Records'], jsonBody(), 'Body: { "records": [{ "id": "recXXX", "fields": { "Name": "..." } }] }'),
  ep('DELETE', '/v0/{baseId}/{tableIdOrName}', 'Delete records', [
    pathP('baseId'), pathP('tableIdOrName'),
    queryP('records[]', true, 'Record IDs to delete'),
  ], ['Records']),
  ep('POST', '/v0/meta/bases', 'Create a base', [], ['Bases'], jsonBody(), 'Body: { "name": "...", "workspaceId": "wspXXX", "tables": [{ "name": "...", "fields": [...] }] }'),
];

// -- Better Stack (Uptime API) ---------------------------------------

const betterstack: EP[] = [
  ep('GET', '/api/v2/monitors', 'List monitors', [
    queryP('per_page', false, 'Results per page'),
  ], ['Monitors']),
  ep('POST', '/api/v2/monitors', 'Create monitor', [], ['Monitors'], jsonBody(), 'Body: { "url": "https://...", "monitor_type": "status", "check_frequency": 180 }'),
  ep('GET', '/api/v2/monitors/{monitor_id}', 'Get monitor', [
    pathP('monitor_id'),
  ], ['Monitors']),
  ep('GET', '/api/v2/heartbeats', 'List heartbeats', [], ['Heartbeats']),
  ep('GET', '/api/v2/incidents', 'List incidents', [
    queryP('per_page', false, 'Results per page'),
  ], ['Incidents']),
  ep('GET', '/api/v2/status-pages', 'List status pages', [], ['Status Pages']),
  ep('GET', '/api/v2/on-calls', 'List on-call calendars', [], ['On-Call']),
  ep('GET', '/api/v2/monitor-groups', 'List monitor groups', [], ['Groups']),
];

// -- Linear ----------------------------------------------------------

const linear: EP[] = [
  ep('POST', '/graphql', 'GraphQL query -- viewer', [], ['GraphQL'], jsonBody(), 'Body: { "query": "{ viewer { id name email } }" }'),
  ep('POST', '/graphql', 'GraphQL query -- list issues', [], ['GraphQL'], jsonBody(), 'Body: { "query": "{ issues(first: 10) { nodes { id title state { name } } } }" }'),
  ep('POST', '/graphql', 'GraphQL query -- list teams', [], ['GraphQL'], jsonBody(), 'Body: { "query": "{ teams { nodes { id name key } } }" }'),
  ep('POST', '/graphql', 'GraphQL query -- list projects', [], ['GraphQL'], jsonBody(), 'Body: { "query": "{ projects(first: 10) { nodes { id name state } } }" }'),
  ep('POST', '/graphql', 'GraphQL mutation -- create issue', [], ['GraphQL'], jsonBody(), 'Body: { "query": "mutation { issueCreate(input: { teamId: \\"...\\" title: \\"...\\" }) { issue { id identifier title } } }" }'),
];

// -- Monday.com ------------------------------------------------------

const monday: EP[] = [
  ep('POST', '/v2', 'GraphQL query -- me', [], ['GraphQL'], jsonBody(), 'Body: { "query": "{ me { id name email } }" }'),
  ep('POST', '/v2', 'GraphQL query -- list boards', [], ['GraphQL'], jsonBody(), 'Body: { "query": "{ boards(limit: 10) { id name state } }" }'),
  ep('POST', '/v2', 'GraphQL query -- list items', [], ['GraphQL'], jsonBody(), 'Body: { "query": "{ boards(ids: [123]) { items_page(limit: 10) { items { id name } } } }" }'),
  ep('POST', '/v2', 'GraphQL mutation -- create item', [], ['GraphQL'], jsonBody(), 'Body: { "query": "mutation { create_item(board_id: 123, item_name: \\"New task\\") { id } }" }'),
  ep('POST', '/v2', 'GraphQL query -- list workspaces', [], ['GraphQL'], jsonBody(), 'Body: { "query": "{ workspaces { id name } }" }'),
];

// -- Dropbox ---------------------------------------------------------

const dropbox: EP[] = [
  ep('POST', '/2/users/get_current_account', 'Get current account', [], ['Users']),
  ep('POST', '/2/files/list_folder', 'List folder', [], ['Files'], jsonBody(), 'Body: { "path": "", "limit": 100 }'),
  ep('POST', '/2/files/get_metadata', 'Get file/folder metadata', [], ['Files'], jsonBody(), 'Body: { "path": "/path/to/file" }'),
  ep('POST', '/2/files/search_v2', 'Search files', [], ['Files'], jsonBody(), 'Body: { "query": "search term", "options": { "max_results": 20 } }'),
  ep('POST', '/2/files/create_folder_v2', 'Create folder', [], ['Files'], jsonBody(), 'Body: { "path": "/new-folder" }'),
  ep('POST', '/2/files/delete_v2', 'Delete file or folder', [], ['Files'], jsonBody(), 'Body: { "path": "/path/to/delete" }'),
];

// -- Convex ----------------------------------------------------------

const convex: EP[] = [
  ep('POST', '/api/query', 'Run a query function', [], ['Functions'], jsonBody(), 'Body: { "path": "messages:list", "args": {} }'),
  ep('POST', '/api/mutation', 'Run a mutation function', [], ['Functions'], jsonBody(), 'Body: { "path": "messages:send", "args": { "body": "Hello" } }'),
  ep('POST', '/api/action', 'Run an action function', [], ['Functions'], jsonBody(), 'Body: { "path": "actions:doSomething", "args": {} }'),
  ep('GET', '/api/json_schemas', 'List tables and JSON schemas', [
    queryP('format', false, 'Output format (json)'),
  ], ['Schema'], null, 'Returns JSON Schema describing all tables and document structures'),
  ep('GET', '/api/list_snapshot', 'Browse documents (snapshot)', [
    queryP('tableName', false, 'Filter to specific table'),
    queryP('cursor', false, 'Pagination cursor'),
    queryP('format', false, 'Output format (json)'),
  ], ['Data'], null, 'Walks a consistent snapshot of documents across one or more paginated calls'),
  ep('GET', '/api/document_deltas', 'Get document changes', [
    queryP('cursor', true, 'Timestamp from previous call'),
    queryP('tableName', false, 'Filter to specific table'),
    queryP('format', false, 'Output format (json)'),
  ], ['Data'], null, 'Walks the change log of documents ordered by mutation timestamp'),
  ep('GET', '/version', 'Get deployment version', [], ['System']),
];

// -- n8n -------------------------------------------------------------

const n8n: EP[] = [
  ep('GET', '/api/v1/workflows', 'List workflows', [
    queryP('limit', false, 'Max workflows'),
  ], ['Workflows']),
  ep('GET', '/api/v1/workflows/{id}', 'Get workflow', [
    pathP('id', 'Workflow ID'),
  ], ['Workflows']),
  ep('POST', '/api/v1/workflows/{id}/activate', 'Activate workflow', [
    pathP('id'),
  ], ['Workflows']),
  ep('POST', '/api/v1/workflows/{id}/deactivate', 'Deactivate workflow', [
    pathP('id'),
  ], ['Workflows']),
  ep('GET', '/api/v1/executions', 'List executions', [
    queryP('limit', false, 'Max executions'),
    queryP('workflowId', false, 'Filter by workflow'),
  ], ['Executions']),
  ep('GET', '/api/v1/credentials', 'List credentials', [], ['Credentials']),
];

// -- Zapier ----------------------------------------------------------

const zapier: EP[] = [
  ep('GET', '/v1/profiles/me', 'Get current user profile', [], ['Profiles']),
  ep('GET', '/v1/zaps', 'List Zaps', [], ['Zaps']),
  ep('GET', '/v1/zaps/{id}', 'Get Zap', [
    pathP('id', 'Zap ID'),
  ], ['Zaps']),
];

// -- Upstash (Redis REST API) ----------------------------------------

const upstash: EP[] = [
  ep('POST', '/', 'Execute Redis command', [], ['Redis'], jsonBody(), 'Body: ["SET", "key", "value"]'),
  ep('GET', '/get/{key}', 'GET key', [
    pathP('key', 'Redis key'),
  ], ['Redis']),
  ep('GET', '/set/{key}/{value}', 'SET key value', [
    pathP('key'), pathP('value'),
  ], ['Redis']),
  ep('GET', '/info', 'Server info', [], ['Redis']),
  ep('GET', '/dbsize', 'Database size', [], ['Redis']),
  ep('POST', '/pipeline', 'Execute pipeline', [], ['Redis'], jsonBody(), 'Body: [["SET","k","v"],["GET","k"]]'),
];

// -- GitHub Actions (reuses github token, different base) ------------

const github_actions: EP[] = [
  ep('GET', '/user', 'Get authenticated user', [], ['Users']),
  ep('GET', '/repos/{owner}/{repo}/actions/workflows', 'List workflows', [
    pathP('owner'), pathP('repo'),
  ], ['Workflows']),
  ep('POST', '/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches', 'Dispatch workflow', [
    pathP('owner'), pathP('repo'), pathP('workflow_id'),
  ], ['Workflows'], jsonBody(), 'Body: { "ref": "main", "inputs": {} }'),
  ep('GET', '/repos/{owner}/{repo}/actions/runs', 'List workflow runs', [
    pathP('owner'), pathP('repo'),
    queryP('per_page', false, 'Results per page'),
  ], ['Runs']),
  ep('GET', '/repos/{owner}/{repo}/actions/runs/{run_id}', 'Get workflow run', [
    pathP('owner'), pathP('repo'), pathP('run_id'),
  ], ['Runs']),
  ep('GET', '/repos/{owner}/{repo}/actions/runs/{run_id}/jobs', 'List jobs for workflow run', [
    pathP('owner'), pathP('repo'), pathP('run_id'),
  ], ['Jobs']),
];

// -- Asana --------------------------------------------------------------

const asana: EP[] = [
  ep('GET', '/users/me', 'Get current user', [], ['Users']),
  ep('GET', '/workspaces', 'List workspaces', [], ['Workspaces']),
  ep('GET', '/projects', 'List projects', [
    queryP('workspace', true, 'Workspace GID'),
  ], ['Projects']),
  ep('GET', '/projects/{project_gid}', 'Get a project', [
    pathP('project_gid', 'Project GID'),
  ], ['Projects']),
  ep('GET', '/projects/{project_gid}/tasks', 'List tasks in project', [
    pathP('project_gid', 'Project GID'),
  ], ['Tasks']),
  ep('POST', '/tasks', 'Create a task', [], ['Tasks'], jsonBody(), 'Body: { "data": { "workspace": "GID", "name": "Task title", "projects": ["GID"] } }'),
  ep('GET', '/tasks/{task_gid}', 'Get a task', [
    pathP('task_gid', 'Task GID'),
  ], ['Tasks']),
  ep('PUT', '/tasks/{task_gid}', 'Update a task', [
    pathP('task_gid', 'Task GID'),
  ], ['Tasks'], jsonBody(), 'Body: { "data": { "name": "Updated title", "completed": true } }'),
];

// -- Kubernetes -------------------------------------------------------

const kubernetes: EP[] = [
  ep('GET', '/api', 'Get API versions', [], ['Core']),
  ep('GET', '/api/v1/namespaces', 'List namespaces', [], ['Core']),
  ep('GET', '/api/v1/namespaces/{namespace}/pods', 'List pods in namespace', [
    pathP('namespace', 'Namespace name'),
  ], ['Core']),
  ep('GET', '/api/v1/namespaces/{namespace}/services', 'List services in namespace', [
    pathP('namespace'),
  ], ['Core']),
  ep('GET', '/apis/apps/v1/namespaces/{namespace}/deployments', 'List deployments', [
    pathP('namespace'),
  ], ['Apps']),
  ep('GET', '/api/v1/nodes', 'List nodes', [], ['Core']),
  ep('GET', '/api/v1/namespaces/{namespace}/configmaps', 'List configmaps', [
    pathP('namespace'),
  ], ['Core']),
  ep('GET', '/api/v1/namespaces/{namespace}/events', 'List events', [
    pathP('namespace'),
  ], ['Core']),
];

// -- Leonardo AI ------------------------------------------------------

const leonardo_ai: EP[] = [
  ep('GET', '/me', 'Get current user info', [], ['Users']),
  ep('POST', '/generations', 'Create image generation', [], ['Generations'], jsonBody(), 'Body: { "prompt": "...", "modelId": "...", "width": 1024, "height": 1024, "num_images": 1 }'),
  ep('GET', '/generations/{id}', 'Get generation by ID', [
    pathP('id', 'Generation ID'),
  ], ['Generations']),
  ep('GET', '/generations/user/{userId}', 'List user generations', [
    pathP('userId', 'User ID'),
    queryP('limit', false, 'Max results (default 10)'),
    queryP('offset', false, 'Pagination offset'),
  ], ['Generations']),
  ep('DELETE', '/generations/{id}', 'Delete a generation', [
    pathP('id', 'Generation ID'),
  ], ['Generations']),
  ep('GET', '/platformModels', 'List platform models', [], ['Models']),
  ep('POST', '/init-image', 'Upload an init image', [], ['Images'], jsonBody(), 'Body: { "extension": "png" }'),
  ep('POST', '/variations/upscale', 'Upscale an image', [], ['Variations'], jsonBody(), 'Body: { "id": "generation-id" }'),
];

// -- Gmail -----------------------------------------------------------

const gmail: EP[] = [
  ep('GET', '/gmail/v1/users/{userId}/messages', 'List messages', [
    pathP('userId', 'User ID (use "me" for authenticated user)'),
    queryP('q', false, 'Gmail search query (e.g. "is:unread")'),
    queryP('maxResults', false, 'Max messages to return'),
    queryP('labelIds', false, 'Filter by label IDs'),
  ], ['Messages']),
  ep('GET', '/gmail/v1/users/{userId}/messages/{id}', 'Get message', [
    pathP('userId', 'User ID (use "me")'),
    pathP('id', 'Message ID'),
    queryP('format', false, 'full, metadata, minimal, raw'),
  ], ['Messages']),
  ep('POST', '/gmail/v1/users/{userId}/messages/send', 'Send message', [
    pathP('userId', 'User ID (use "me")'),
  ], ['Messages'], jsonBody(), 'Body: { "raw": "<base64url-encoded RFC 2822 message>" }'),
  ep('GET', '/gmail/v1/users/{userId}/labels', 'List labels', [
    pathP('userId', 'User ID (use "me")'),
  ], ['Labels']),
  ep('GET', '/gmail/v1/users/{userId}/threads', 'List threads', [
    pathP('userId', 'User ID (use "me")'),
    queryP('q', false, 'Gmail search query'),
    queryP('maxResults', false, 'Max threads to return'),
  ], ['Threads']),
  ep('GET', '/gmail/v1/users/{userId}/threads/{id}', 'Get thread', [
    pathP('userId', 'User ID (use "me")'),
    pathP('id', 'Thread ID'),
    queryP('format', false, 'full, metadata, minimal'),
  ], ['Threads']),
  ep('GET', '/gmail/v1/users/{userId}/drafts', 'List drafts', [
    pathP('userId', 'User ID (use "me")'),
    queryP('maxResults', false, 'Max drafts to return'),
  ], ['Drafts']),
  ep('GET', '/gmail/v1/users/{userId}/profile', 'Get user profile', [
    pathP('userId', 'User ID (use "me")'),
  ], ['Users']),
];

// -- Google Sheets ---------------------------------------------------

const google_sheets: EP[] = [
  ep('POST', '/v4/spreadsheets', 'Create a spreadsheet', [], ['Spreadsheets'], jsonBody(), 'Body: { "properties": { "title": "My Spreadsheet" } }'),
  ep('GET', '/v4/spreadsheets/{spreadsheetId}', 'Get spreadsheet metadata', [
    pathP('spreadsheetId', 'Spreadsheet ID'),
    queryP('includeGridData', false, 'true to include cell data'),
  ], ['Spreadsheets']),
  ep('GET', '/v4/spreadsheets/{spreadsheetId}/values/{range}', 'Get cell values', [
    pathP('spreadsheetId', 'Spreadsheet ID'),
    pathP('range', 'A1 notation range (e.g. Sheet1!A1:D10)'),
    queryP('majorDimension', false, 'ROWS or COLUMNS'),
    queryP('valueRenderOption', false, 'FORMATTED_VALUE, UNFORMATTED_VALUE, FORMULA'),
  ], ['Values']),
  ep('PUT', '/v4/spreadsheets/{spreadsheetId}/values/{range}', 'Update cell values', [
    pathP('spreadsheetId', 'Spreadsheet ID'),
    pathP('range', 'A1 notation range'),
    queryP('valueInputOption', true, 'RAW or USER_ENTERED'),
  ], ['Values'], jsonBody(), 'Body: { "values": [["A1","B1"],["A2","B2"]] }'),
  ep('POST', '/v4/spreadsheets/{spreadsheetId}/values/{range}:append', 'Append rows', [
    pathP('spreadsheetId', 'Spreadsheet ID'),
    pathP('range', 'A1 notation range (e.g. Sheet1!A:A)'),
    queryP('valueInputOption', true, 'RAW or USER_ENTERED'),
    queryP('insertDataOption', false, 'INSERT_ROWS or OVERWRITE'),
  ], ['Values'], jsonBody(), 'Body: { "values": [["new","row"]] }'),
  ep('GET', '/v4/spreadsheets/{spreadsheetId}/values:batchGet', 'Batch get values', [
    pathP('spreadsheetId', 'Spreadsheet ID'),
    queryP('ranges', true, 'Comma-separated A1 ranges'),
    queryP('majorDimension', false, 'ROWS or COLUMNS'),
  ], ['Values']),
  ep('POST', '/v4/spreadsheets/{spreadsheetId}/values:batchUpdate', 'Batch update values', [
    pathP('spreadsheetId', 'Spreadsheet ID'),
  ], ['Values'], jsonBody(), 'Body: { "valueInputOption": "USER_ENTERED", "data": [{ "range": "Sheet1!A1", "values": [["val"]] }] }'),
  ep('POST', '/v4/spreadsheets/{spreadsheetId}:batchUpdate', 'Batch update spreadsheet', [
    pathP('spreadsheetId', 'Spreadsheet ID'),
  ], ['Spreadsheets'], jsonBody(), 'Body: { "requests": [{ "addSheet": { "properties": { "title": "New Sheet" } } }] }'),
];

// -- Microsoft Outlook (Graph API) -----------------------------------

const microsoft_outlook: EP[] = [
  ep('GET', '/v1.0/me', 'Get current user profile', [], ['Users']),
  ep('GET', '/v1.0/me/messages', 'List messages', [
    queryP('$top', false, 'Number of messages to return'),
    queryP('$filter', false, 'OData filter (e.g. isRead eq false)'),
    queryP('$select', false, 'Fields to return (e.g. subject,from,receivedDateTime)'),
    queryP('$orderby', false, 'Sort order (e.g. receivedDateTime desc)'),
  ], ['Mail']),
  ep('GET', '/v1.0/me/messages/{id}', 'Get message by ID', [
    pathP('id', 'Message ID'),
    queryP('$select', false, 'Fields to return'),
  ], ['Mail']),
  ep('POST', '/v1.0/me/sendMail', 'Send an email', [], ['Mail'], jsonBody(), 'Body: { "message": { "subject": "Hello", "body": { "contentType": "Text", "content": "Hello World" }, "toRecipients": [{ "emailAddress": { "address": "user@example.com" } }] } }'),
  ep('GET', '/v1.0/me/mailFolders', 'List mail folders', [
    queryP('$top', false, 'Number of folders'),
  ], ['Mail Folders']),
  ep('GET', '/v1.0/me/events', 'List calendar events', [
    queryP('$top', false, 'Number of events'),
    queryP('$filter', false, 'OData filter'),
    queryP('$orderby', false, 'Sort order (e.g. start/dateTime)'),
  ], ['Calendar']),
  ep('POST', '/v1.0/me/events', 'Create calendar event', [], ['Calendar'], jsonBody(), 'Body: { "subject": "Meeting", "start": { "dateTime": "2026-01-01T10:00:00", "timeZone": "UTC" }, "end": { "dateTime": "2026-01-01T11:00:00", "timeZone": "UTC" } }'),
  ep('GET', '/v1.0/me/contacts', 'List contacts', [
    queryP('$top', false, 'Number of contacts'),
    queryP('$select', false, 'Fields to return'),
  ], ['Contacts']),
];

// -- LinkedIn --------------------------------------------------------

const linkedin: EP[] = [
  ep('GET', '/v2/userinfo', 'Get authenticated user info', [], ['User']),
  ep('GET', '/v2/me', 'Get current member profile', [], ['Profile']),
  ep('POST', '/v2/posts', 'Create a post (share)', [], ['Posts'], jsonBody(), 'Body: { "author": "urn:li:person:{id}", "commentary": "Hello LinkedIn!", "visibility": "PUBLIC", "distribution": { "feedDistribution": "MAIN_FEED" }, "lifecycleState": "PUBLISHED" }'),
  ep('GET', '/v2/connections?q=viewer&start=0&count=10', 'List connections', [], ['Connections']),
  ep('GET', '/v2/organizationalEntityAcls?q=roleAssignee', 'List managed pages', [], ['Organizations']),
];

// -- Export ------------------------------------------------------------

// -- Canva ------------------------------------------------------------

const canva: EP[] = [
  ep('GET', '/users/me', 'Get current user profile', [], ['Users']),
  ep('GET', '/designs', 'List designs', [queryP('query', false, 'Search term'), queryP('continuation', false)], ['Designs']),
  ep('GET', '/designs/{designId}', 'Get design', [pathP('designId')], ['Designs']),
  ep('POST', '/designs', 'Create design', [], ['Designs'], jsonBody()),
  ep('POST', '/exports', 'Export design', [], ['Exports'], jsonBody()),
  ep('GET', '/exports/{exportId}', 'Get export status', [pathP('exportId')], ['Exports']),
];

// -- Pipedrive --------------------------------------------------------

const pipedrive: EP[] = [
  ep('GET', '/users/me', 'Get current user', [], ['Users']),
  ep('GET', '/deals', 'List deals', [queryP('status', false, 'open, won, lost, deleted')], ['Deals']),
  ep('POST', '/deals', 'Create deal', [], ['Deals'], jsonBody()),
  ep('GET', '/persons', 'List persons', [queryP('start', false), queryP('limit', false)], ['Persons']),
  ep('POST', '/persons', 'Create person', [], ['Persons'], jsonBody()),
  ep('GET', '/organizations', 'List organizations', [], ['Organizations']),
  ep('GET', '/activities', 'List activities', [queryP('type', false)], ['Activities']),
  ep('GET', '/pipelines', 'List pipelines', [], ['Pipelines']),
];

// -- Attio ------------------------------------------------------------

const attio: EP[] = [
  ep('GET', '/self', 'Get current workspace', [], ['Self']),
  ep('GET', '/objects', 'List objects', [], ['Objects']),
  ep('POST', '/objects/{object}/records/query', 'Query records', [pathP('object', 'Object slug or ID')], ['Records'], jsonBody()),
  ep('POST', '/objects/{object}/records', 'Create record', [pathP('object')], ['Records'], jsonBody()),
  ep('GET', '/lists', 'List lists', [], ['Lists']),
  ep('POST', '/lists/{list}/entries/query', 'Query list entries', [pathP('list')], ['Lists'], jsonBody()),
  ep('POST', '/notes', 'Create note', [], ['Notes'], jsonBody()),
];

// -- Crisp ------------------------------------------------------------

const crisp: EP[] = [
  ep('GET', '/website', 'List websites', [], ['Websites']),
  ep('GET', '/website/{websiteId}/conversations', 'List conversations', [pathP('websiteId')], ['Conversations']),
  ep('GET', '/website/{websiteId}/conversation/{sessionId}/messages', 'Get messages', [pathP('websiteId'), pathP('sessionId')], ['Messages']),
  ep('POST', '/website/{websiteId}/conversation/{sessionId}/message', 'Send message', [pathP('websiteId'), pathP('sessionId')], ['Messages'], jsonBody()),
  ep('GET', '/website/{websiteId}/people/profiles', 'List people', [pathP('websiteId')], ['People']),
];

// -- WooCommerce -----------------------------------------------------

const woocommerce: EP[] = [
  ep('GET', '/wp-json/wc/v3/orders', 'List orders', [queryP('status', false, 'pending, processing, completed'), queryP('per_page', false)], ['Orders']),
  ep('GET', '/wp-json/wc/v3/orders/{id}', 'Get order', [pathP('id')], ['Orders']),
  ep('GET', '/wp-json/wc/v3/products', 'List products', [queryP('per_page', false)], ['Products']),
  ep('POST', '/wp-json/wc/v3/products', 'Create product', [], ['Products'], jsonBody()),
  ep('GET', '/wp-json/wc/v3/customers', 'List customers', [], ['Customers']),
  ep('GET', '/wp-json/wc/v3/reports/sales', 'Sales report', [queryP('period', false, 'week, month, year')], ['Reports']),
];

// -- Lemon Squeezy ---------------------------------------------------

const lemonsqueezy: EP[] = [
  ep('GET', '/users/me', 'Get current user', [], ['Users']),
  ep('GET', '/stores', 'List stores', [], ['Stores']),
  ep('GET', '/products', 'List products', [queryP('filter[store_id]', false)], ['Products']),
  ep('GET', '/orders', 'List orders', [queryP('filter[store_id]', false)], ['Orders']),
  ep('GET', '/subscriptions', 'List subscriptions', [], ['Subscriptions']),
  ep('GET', '/customers', 'List customers', [], ['Customers']),
];

// -- Novu ------------------------------------------------------------

const novu: EP[] = [
  ep('GET', '/environments/me', 'Get current environment', [], ['Environments']),
  ep('POST', '/events/trigger', 'Trigger notification', [], ['Events'], jsonBody()),
  ep('GET', '/subscribers', 'List subscribers', [queryP('page', false)], ['Subscribers']),
  ep('POST', '/subscribers', 'Create subscriber', [], ['Subscribers'], jsonBody()),
  ep('GET', '/workflows', 'List workflows', [queryP('page', false)], ['Workflows']),
  ep('GET', '/notifications', 'List notifications', [queryP('page', false)], ['Notifications']),
];

// -- Knock -----------------------------------------------------------

const knock: EP[] = [
  ep('GET', '/users', 'List users', [queryP('page_size', false)], ['Users']),
  ep('PUT', '/users/{userId}', 'Identify user', [pathP('userId')], ['Users'], jsonBody()),
  ep('GET', '/workflows', 'List workflows', [], ['Workflows']),
  ep('POST', '/workflows/{workflowKey}/trigger', 'Trigger workflow', [pathP('workflowKey')], ['Workflows'], jsonBody()),
  ep('GET', '/users/{userId}/messages', 'List user messages', [pathP('userId')], ['Messages']),
  ep('GET', '/users/{userId}/preferences', 'Get user preferences', [pathP('userId')], ['Preferences']),
];

// -- Obsidian (Local REST API) -------------------------------------------

const obsidian: EP[] = [
  ep('GET', '/vault/', 'List vault root files', [], ['Vault']),
  ep('GET', '/vault/{filename}', 'Read a note', [pathP('filename', 'Path to note (e.g. folder/note.md)')], ['Vault']),
  ep('PUT', '/vault/{filename}', 'Create or replace a note', [pathP('filename')], ['Vault'], jsonBody()),
  ep('POST', '/vault/{filename}', 'Append to a note', [pathP('filename')], ['Vault'], jsonBody()),
  ep('DELETE', '/vault/{filename}', 'Delete a note', [pathP('filename')], ['Vault']),
  ep('POST', '/search/simple/', 'Search vault by text', [], ['Search'], jsonBody()),
  ep('GET', '/active/', 'Get active file content', [], ['Active']),
  ep('GET', '/commands/', 'List available commands', [], ['Commands']),
  ep('POST', '/commands/{commandId}/', 'Execute a command', [pathP('commandId', 'Command ID to execute')], ['Commands']),
];

export const CATALOG_API_ENDPOINTS: Record<string, ApiEndpoint[]> = {
  azure_devops,
  github,
  gitlab,
  slack,
  discord,
  cloudflare,
  vercel,
  netlify,
  hubspot,
  sentry,
  posthog,
  sendgrid,
  twilio_sms,
  jira,
  confluence,
  circleci,
  figma,
  supabase,
  neon,
  clickup,
  resend,
  mixpanel,
  twilio_segment,
  planetscale,
  notion,
  cal_com,
  calendly,
  telegram,
  buffer,
  // Added -- previously missing
  airtable,
  betterstack,
  linear,
  monday,
  dropbox,
  convex,
  n8n,
  zapier,
  upstash,
  github_actions,
  asana,
  kubernetes,
  leonardo_ai,
  linkedin,
  google_sheets,
  gmail,
  microsoft_outlook,
  // New connectors
  canva,
  pipedrive,
  attio,
  crisp,
  woocommerce,
  lemonsqueezy,
  novu,
  knock,
  obsidian,
};
