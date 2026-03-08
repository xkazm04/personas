# Digital Clone - Communication API Research

**Researched:** 2026-03-08
**Purpose:** Real API endpoints, auth methods, and capabilities for a Digital Clone AI communication agent
**Overall Confidence:** HIGH (verified against official documentation)

---

## 1. Gmail API

**API Base URL:** `https://gmail.googleapis.com`
**Auth Method:** OAuth 2.0 (Google Cloud Console credentials)
**Auth Header:** `Authorization: Bearer <access_token>`
**Scopes needed:**
- `https://www.googleapis.com/auth/gmail.readonly` (read)
- `https://www.googleapis.com/auth/gmail.send` (send)
- `https://www.googleapis.com/auth/gmail.modify` (labels, modify)

### Key Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/gmail/v1/users/{userId}/messages` | List messages in mailbox |
| GET | `/gmail/v1/users/{userId}/messages/{id}` | Get a specific message |
| POST | `/gmail/v1/users/{userId}/messages/send` | Send a new email |
| GET | `/gmail/v1/users/{userId}/threads` | List conversation threads |
| GET | `/gmail/v1/users/{userId}/threads/{id}` | Get full thread with all messages |
| GET | `/gmail/v1/users/{userId}/labels` | List all labels |
| POST | `/gmail/v1/users/{userId}/labels` | Create a new label |
| POST | `/gmail/v1/users/{userId}/messages/{id}/modify` | Add/remove labels on a message |

Note: `{userId}` can be the literal string `me` to refer to the authenticated user.

### Webhook / Real-Time Events

Gmail does NOT use traditional webhooks. It uses **Google Cloud Pub/Sub** push notifications.

**Setup flow:**
1. Create a Cloud Pub/Sub topic (e.g., `projects/myproject/topics/gmail-notifications`)
2. Grant publish rights to `gmail-api-push@system.gserviceaccount.com` on the topic
3. Create a subscription (push to your HTTPS endpoint, or pull)
4. Call the watch endpoint:

```
POST /gmail/v1/users/me/watch
{
  "topicName": "projects/myproject/topics/gmail-notifications",
  "labelIds": ["INBOX"],
  "labelFilterBehavior": "INCLUDE"
}
```

**Notification payload** (base64url-encoded in Pub/Sub message):
```json
{
  "emailAddress": "user@example.com",
  "historyId": "9876543210"
}
```

Then use `GET /gmail/v1/users/me/history?startHistoryId={historyId}` to fetch actual changes.

**Important constraints:**
- Watch must be renewed at least every 7 days (daily recommended)
- Rate limit: max 1 notification/second per user
- All Pub/Sub notifications must be acknowledged (HTTP 200 for push)

**Confidence:** HIGH -- verified from official Google developer docs.

---

## 2. Slack API

**API Base URL:** `https://slack.com/api/`
**Auth Method:** OAuth 2.0 / Bot Token
**Auth Header:** `Authorization: Bearer xoxb-xxxxxxxxxxxx`
**Token types:**
- `xoxb-` = Bot token (recommended for agents)
- `xoxp-` = User token (acts as a user)
- `xapp-` = App-level token (for Socket Mode)

### Key Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/chat.postMessage` | Send a message to a channel/DM |
| POST | `/api/chat.update` | Edit an existing message |
| GET | `/api/conversations.list` | List channels the bot can see |
| GET | `/api/conversations.history` | Fetch message history for a channel |
| GET | `/api/conversations.replies` | Fetch threaded replies to a message |
| POST | `/api/reactions.add` | Add an emoji reaction to a message |
| GET | `/api/users.info` | Get user profile information |
| POST | `/api/conversations.open` | Open/create a DM with a user |

**Request format (JSON POST):**
```
POST https://slack.com/api/chat.postMessage
Content-type: application/json
Authorization: Bearer xoxb-xxxxxxxxxxxx

{
  "channel": "C1234567890",
  "text": "Hello from Digital Clone",
  "thread_ts": "1234567890.123456"   // optional, for threaded replies
}
```

### Webhook / Real-Time Events

Slack offers two modes for real-time event reception:

**Option A: Events API (HTTP webhook)**
- Configure a Request URL in app settings
- Slack sends HTTP POST to your endpoint for subscribed events
- Requires a public HTTPS endpoint
- Must respond to URL verification challenge
- Key events: `message.channels`, `message.im`, `reaction_added`, `app_mention`

**Option B: Socket Mode (recommended for agents without public URL)**
- Uses WebSocket connection instead of public HTTP endpoint
- Requires an app-level token (`xapp-`)
- Call `apps.connections.open` to get a WebSocket URL
- WebSocket URL refreshes regularly
- No public endpoint needed

**Confidence:** HIGH -- verified from official Slack developer docs (docs.slack.dev).

---

## 3. Microsoft Teams API (via Microsoft Graph)

**API Base URL:** `https://graph.microsoft.com/v1.0`
**Auth Method:** OAuth 2.0 (Microsoft Identity Platform / Entra ID)
**Auth Header:** `Authorization: Bearer <access_token>`
**Token endpoint:** `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`

**Two auth flows:**
- **Delegated** (on behalf of user): Authorization Code Grant flow, uses `/authorize` then `/token`
- **Application** (daemon/service): Client Credentials Grant flow, uses `/token` directly with client_id + client_secret

**Key permissions:** `Chat.ReadWrite`, `ChannelMessage.Send`, `ChannelMessage.Read.All`, `Chat.Read`, `User.Read`

### Key Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/chats/{chat-id}/messages` | Send a message in a 1:1 or group chat |
| POST | `/teams/{team-id}/channels/{channel-id}/messages` | Send a message in a channel |
| POST | `/teams/{team-id}/channels/{channel-id}/messages/{message-id}/replies` | Reply to a channel message |
| GET | `/chats/{chat-id}/messages` | List messages in a chat |
| GET | `/teams/{team-id}/channels/{channel-id}/messages` | List messages in a channel |
| GET | `/me/joinedTeams` | List teams the user belongs to |
| GET | `/teams/{team-id}/channels` | List channels in a team |
| POST | `/teams/{team-id}/members` | Add a member to a team |

**Request body (sending a message):**
```json
{
  "body": {
    "content": "Hello from Digital Clone"
  }
}
```

### Webhook / Real-Time Events

Microsoft Graph uses **Change Notifications (Subscriptions)**.

**Create a subscription:**
```
POST https://graph.microsoft.com/v1.0/subscriptions
{
  "changeType": "created",
  "notificationUrl": "https://your-server.com/webhook",
  "resource": "/chats/getAllMessages",
  "expirationDateTime": "2026-03-09T00:00:00Z",
  "clientState": "secretClientState"
}
```

**Subscription resources for Teams:**
- `/chats/getAllMessages` -- all chat messages across tenant (application permission)
- `/teams/{team-id}/channels/{channel-id}/messages` -- messages in a specific channel
- `/chats/{chat-id}/messages` -- messages in a specific chat
- `/teams/getAllMessages` -- all channel messages across tenant

**Important constraints:**
- Subscriptions expire and must be renewed (max ~1 hour for chat messages; use `lifecycleNotificationUrl` for longer)
- Polling is limited to once per day (subscriptions are the intended pattern)
- Requires appropriate application or delegated permissions

**Confidence:** HIGH -- verified from official Microsoft Learn documentation.

---

## 4. WhatsApp Business Cloud API

**API Base URL:** `https://graph.facebook.com/v23.0`
**Auth Method:** Bearer token (System User Access Token from Meta Business Manager)
**Auth Header:** `Authorization: Bearer <ACCESS_TOKEN>`

**Prerequisites:**
- Meta Business account
- WhatsApp Business Account (WABA)
- Registered phone number
- On-Premises API was deprecated October 2025; Cloud API is the only supported path

### Key Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/{phone-number-id}/messages` | Send a message (text, template, media) |
| GET | `/{phone-number-id}` | Get phone number details |
| POST | `/{phone-number-id}/register` | Register a phone number |
| GET | `/{waba-id}/message_templates` | List message templates |
| POST | `/{waba-id}/message_templates` | Create a message template |
| GET | `/{waba-id}/phone_numbers` | List registered phone numbers |
| POST | `/{phone-number-id}/media` | Upload media for sending |
| GET | `/{media-id}` | Download media from received messages |

**Send message request body:**
```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "15551234567",
  "type": "text",
  "text": {
    "body": "Hello from Digital Clone"
  }
}
```

### Webhook / Real-Time Events

WhatsApp uses **Meta Webhooks** for incoming messages.

**Setup:**
1. In Meta App Dashboard, configure Webhooks under WhatsApp product
2. Set a Callback URL (your HTTPS endpoint) and a Verify Token
3. Meta sends a GET verification challenge; respond with `hub.challenge`
4. Subscribe to webhook fields: `messages`, `message_status`

**Incoming message webhook payload structure:**
```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "WABA_ID",
    "changes": [{
      "field": "messages",
      "value": {
        "messages": [{
          "from": "15551234567",
          "type": "text",
          "text": { "body": "Hello" },
          "timestamp": "1234567890"
        }]
      }
    }]
  }]
}
```

**Important constraints:**
- Outbound messages outside 24-hour window require pre-approved templates
- Pricing changed July 2025: per-template-message billing (not conversation-based)
- Must respond with HTTP 200 to all webhook deliveries

**Confidence:** MEDIUM-HIGH -- base URL and endpoint structure verified from multiple sources including official Meta docs references and Postman collection. Exact v23.0 version number confirmed from official curl examples.

---

## 5. Telegram Bot API

**API Base URL:** `https://api.telegram.org/bot<TOKEN>/`
**Auth Method:** Bot Token (obtained from @BotFather)
**Token format:** `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`
**No separate auth header needed** -- token is embedded in the URL path.

### Key Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/bot<TOKEN>/sendMessage` | Send a text message |
| POST | `/bot<TOKEN>/sendPhoto` | Send a photo |
| POST | `/bot<TOKEN>/sendDocument` | Send a document/file |
| GET | `/bot<TOKEN>/getUpdates` | Long-poll for new messages/events |
| POST | `/bot<TOKEN>/setWebhook` | Set HTTPS webhook URL for push updates |
| GET | `/bot<TOKEN>/getWebhookInfo` | Check current webhook status |
| POST | `/bot<TOKEN>/deleteWebhook` | Remove webhook |
| GET | `/bot<TOKEN>/getMe` | Get bot's own user info |

**sendMessage request body:**
```json
{
  "chat_id": 123456789,
  "text": "Hello from Digital Clone",
  "reply_to_message_id": 42,
  "parse_mode": "Markdown"
}
```

### Webhook / Real-Time Events

Telegram offers two approaches:

**Option A: Long Polling**
```
GET https://api.telegram.org/bot<TOKEN>/getUpdates?offset=12345&timeout=30
```
- `offset`: ID of the first update to return (use last update_id + 1)
- `timeout`: long-poll timeout in seconds (0-50, recommended 30)
- Simple, no public server needed

**Option B: Webhook (recommended for production)**
```
POST https://api.telegram.org/bot<TOKEN>/setWebhook
{
  "url": "https://your-server.com/telegram-webhook",
  "allowed_updates": ["message", "callback_query"]
}
```
- Requires valid HTTPS endpoint with a trusted certificate
- Telegram sends POST with JSON update object to your URL
- You must respond with HTTP 200
- Can optionally return a method call in the response body (e.g., sendMessage) to save a round trip

**Update object includes:** `message`, `edited_message`, `channel_post`, `callback_query`, `inline_query`

**Confidence:** HIGH -- verified from official Telegram Bot API documentation (core.telegram.org/bots/api).

---

## 6. Notion API

**API Base URL:** `https://api.notion.com/v1`
**Auth Method:** Bearer token (Internal Integration Token or OAuth 2.0 for public integrations)
**Auth Header:** `Authorization: Bearer <NOTION_API_KEY>`
**Required Header:** `Notion-Version: 2022-06-28` (API version header is mandatory)

### Key Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/databases/{database_id}/query` | Query/filter database entries |
| POST | `/pages` | Create a new page (= database row) |
| GET | `/pages/{page_id}` | Retrieve a page and its properties |
| PATCH | `/pages/{page_id}` | Update page properties |
| DELETE | `/blocks/{block_id}` | Delete a block (archive a page) |
| GET | `/blocks/{block_id}/children` | Get child blocks of a page |
| PATCH | `/blocks/{block_id}/children` | Append blocks (content) to a page |
| POST | `/search` | Search across all shared pages/databases |

**Create a page (log entry) request body:**
```json
{
  "parent": { "database_id": "abc123" },
  "properties": {
    "Name": { "title": [{ "text": { "content": "Conversation with John" } }] },
    "Platform": { "select": { "name": "Slack" } },
    "Timestamp": { "date": { "start": "2026-03-08T12:00:00Z" } },
    "Summary": { "rich_text": [{ "text": { "content": "Discussed project timeline..." } }] }
  }
}
```

### Webhook / Real-Time Events

**Notion does NOT have native webhooks or real-time event support.**

For detecting changes, you must poll:
- Use `POST /databases/{database_id}/query` with a `filter` on `last_edited_time`
- Use `POST /search` with `filter` and `sort` parameters

**Workaround options:**
- Poll on a timer (e.g., every 30-60 seconds)
- Use third-party services (Zapier, Make/Integromat) that poll Notion and trigger webhooks
- Notion's API has cursor-based pagination (default 10 items, max 100 per call)

**Important constraints:**
- Database must be explicitly shared with the integration
- Rate limit: 3 requests/second per integration
- Property names use `snake_case`
- All temporal values use ISO 8601

**Confidence:** HIGH -- verified from official Notion API documentation (developers.notion.com).

---

## Cross-Service Summary for Digital Clone Architecture

### Auth Method Comparison

| Service | Auth Type | Token Format | Refresh Needed |
|---------|-----------|-------------|----------------|
| Gmail | OAuth 2.0 | Bearer token | Yes (refresh tokens) |
| Slack | OAuth 2.0 / Bot Token | `xoxb-` bot token | No (bot tokens don't expire) |
| MS Teams | OAuth 2.0 (Entra ID) | Bearer token | Yes (refresh tokens / client creds) |
| WhatsApp | System User Token | Bearer token | Yes (can create long-lived tokens) |
| Telegram | Bot Token | In URL path | No (permanent until revoked) |
| Notion | Integration Token | Bearer token | No (internal integrations) |

### Real-Time Event Reception Comparison

| Service | Webhook | Long Poll | WebSocket | Pub/Sub | Setup Complexity |
|---------|---------|-----------|-----------|---------|-----------------|
| Gmail | Via Pub/Sub | No | No | Yes | HIGH |
| Slack | Events API | No | Socket Mode | No | MEDIUM |
| MS Teams | Change Notifications | No | No | No | HIGH |
| WhatsApp | Meta Webhooks | No | No | No | MEDIUM |
| Telegram | setWebhook | getUpdates | No | No | LOW |
| Notion | None | Must poll | No | No | N/A (poll only) |

### Recommendation for Digital Clone Agent

**Easiest to integrate first:** Telegram (simple bot token auth, no OAuth flow, built-in long polling for dev, webhook for prod)

**Most complex integration:** Gmail (Pub/Sub setup) and MS Teams (Entra ID tenant config, subscription lifecycle management)

**Suggested integration order:**
1. Telegram -- simplest auth, immediate feedback loop for testing
2. Slack -- Socket Mode avoids needing a public URL during development
3. Notion -- logging/memory layer, no webhooks to manage
4. Gmail -- OAuth 2.0 + Pub/Sub adds complexity
5. WhatsApp -- requires Meta Business verification process
6. MS Teams -- most enterprise overhead (Entra ID, admin consent, subscription renewal)

---

## Sources

- [Gmail API Reference](https://developers.google.com/gmail/api/reference/rest) -- HIGH confidence
- [Gmail Push Notifications](https://developers.google.com/gmail/api/guides/push) -- HIGH confidence
- [Slack Web API](https://docs.slack.dev/apis/web-api/) -- HIGH confidence
- [Slack Events API](https://docs.slack.dev/apis/events-api/) -- HIGH confidence
- [Slack Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/) -- HIGH confidence
- [Microsoft Graph Teams API Overview](https://learn.microsoft.com/en-us/graph/api/resources/teams-api-overview) -- HIGH confidence
- [Microsoft Graph Chat Message API](https://learn.microsoft.com/en-us/graph/api/chatmessage-post) -- HIGH confidence
- [Microsoft Graph Change Notifications](https://learn.microsoft.com/en-us/graph/teams-changenotifications-chatmessage) -- HIGH confidence
- [Microsoft Graph Auth Concepts](https://learn.microsoft.com/en-us/graph/auth/auth-concepts) -- HIGH confidence
- [WhatsApp Cloud API Messages Reference](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages/) -- MEDIUM-HIGH confidence
- [WhatsApp Cloud API Guide](https://gurusup.com/blog/whatsapp-cloud-api) -- MEDIUM confidence
- [Telegram Bot API](https://core.telegram.org/bots/api) -- HIGH confidence
- [Notion API Reference](https://developers.notion.com/reference/intro) -- HIGH confidence
