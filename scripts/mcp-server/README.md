# Personas MCP Server for Claude Desktop

Exposes 23 Personas agent management tools via MCP, enabling full agent lifecycle management from Claude Desktop — execute, test, improve, version, monitor, and schedule personas.

> Full documentation: [`docs/claude-desktop-integration.md`](../../docs/claude-desktop-integration.md)

## Prerequisites

- **Personas desktop app** must have been launched at least once (creates the database)
- **Node.js** >= 18

## Setup

```bash
cd scripts/mcp-server
npm install
```

## Integration with Claude Desktop

Add the following to your Claude Desktop configuration file:

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "personas": {
      "command": "node",
      "args": ["C:\\Users\\mkdol\\dolla\\personas\\scripts\\mcp-server\\index.mjs"]
    }
  }
}
```

Then restart Claude Desktop.

## Integration with Claude Code CLI

```bash
claude mcp add-json personas '{"command":"node","args":["C:\\Users\\mkdol\\dolla\\personas\\scripts\\mcp-server\\index.mjs"]}'
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PERSONAS_DB_PATH` | Auto-detected | Override the Personas database path |
| `PERSONAS_PORT` | `9420` | Personas webhook server port (for execute_persona) |

## Available Tools (23)

See [`docs/claude-desktop-integration.md`](../../docs/claude-desktop-integration.md) for full tool documentation, or run:

```bash
cd scripts/mcp-server && node -e "
const {spawn}=require('child_process');
const s=spawn('node',['index.mjs'],{stdio:['pipe','pipe','pipe']});
s.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'t',version:'1'}}})+'\n');
s.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
s.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}})+'\n');
s.stdout.on('data',d=>{try{const r=JSON.parse(d.toString().split('\n').pop());if(r.result?.tools)r.result.tools.forEach(t=>console.log(t.name+': '+t.description))}catch{}});
setTimeout(()=>s.kill(),3000);
"
```

## Example Usage in Claude Desktop

Once configured, you can ask Claude:

- "Show me all my personas and their status"
- "What's the health of my Tech News Digest agent?"
- "List the last 5 failed executions"
- "Show me the lab test results for my SEC filing analyzer"
- "What has my knowledge graph learned about API rate limits?"
- "Run my Daily Programming Learner agent"
- "Show me prompt version history for Tech Impact Monitor"

## Architecture

```
Claude Desktop  <--stdio-->  MCP Server (Node.js)  <--read-->  Personas SQLite DB
                                                    <--HTTP-->  Personas Webhook (port 9420)
```

The MCP server reads the Personas database directly (read-only, WAL-safe) for all query operations. For triggering executions, it sends HTTP POST requests to the Personas webhook server which must be running (the Personas desktop app must be open).

## Security Notes

- Database is opened in **read-only** mode - the MCP server cannot modify data
- Credentials are listed by **name and type only** - secrets are never exposed
- Execution triggers go through the existing webhook authentication layer
- The MCP server runs locally via stdio transport - no network exposure
