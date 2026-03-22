#!/usr/bin/env python3
"""
Generate 30 best-practice templates from existing personas in the DB.
Produces connector-agnostic template JSONs with all 8 PersonaMatrix dimensions.

Writes to: scripts/templates/{category}/{id}.json
"""

import json
import os
import re
import sqlite3
import sys
from pathlib import Path

DB_PATH = os.path.join(os.environ.get("APPDATA", ""), "com.personas.desktop", "personas.db")
TEMPLATES_DIR = Path(__file__).parent.parent.parent / "scripts" / "templates"

# Category mapping based on persona name/description patterns
CATEGORY_MAP = {
    "email": ["email"],
    "gmail": ["email"],
    "newsletter": ["content", "email"],
    "content": ["content"],
    "blog": ["content"],
    "sales": ["sales"],
    "deal": ["sales"],
    "lead": ["sales"],
    "proposal": ["sales"],
    "invoice": ["finance"],
    "expense": ["finance"],
    "receipt": ["finance"],
    "budget": ["finance"],
    "payment": ["finance"],
    "support": ["support"],
    "feedback": ["support"],
    "complaint": ["support"],
    "nps": ["support"],
    "onboarding": ["hr"],
    "applicant": ["hr"],
    "leave": ["hr"],
    "team": ["hr"],
    "incident": ["devops"],
    "service": ["devops"],
    "access": ["security"],
    "security": ["security"],
    "phishing": ["security"],
    "research": ["research"],
    "knowledge": ["research"],
    "learning": ["research"],
    "meeting": ["productivity"],
    "standup": ["productivity"],
    "task": ["productivity"],
    "review": ["productivity"],
    "habit": ["productivity"],
    "goal": ["productivity"],
    "metrics": ["research"],
    "anomaly": ["devops"],
    "survey": ["productivity"],
    "decision": ["project-management"],
    "idea": ["productivity"],
    "glossary": ["research"],
    "reading": ["productivity"],
    "change": ["devops"],
    "docs": ["development"],
    "documentation": ["development"],
    "contact": ["sales"],
    "campaign": ["marketing"],
    "calendar": ["productivity"],
}

ICON_MAP = {
    "email": "Mail",
    "content": "FileText",
    "sales": "TrendingUp",
    "finance": "DollarSign",
    "support": "HelpCircle",
    "hr": "Users",
    "devops": "Server",
    "security": "Shield",
    "research": "Search",
    "productivity": "Zap",
    "project-management": "Target",
    "marketing": "Megaphone",
    "development": "Code",
}


def slugify(name: str) -> str:
    """Convert persona name to kebab-case slug."""
    s = name.lower().strip()
    s = re.sub(r'[^a-z0-9\s-]', '', s)
    s = re.sub(r'[\s_]+', '-', s)
    s = re.sub(r'-+', '-', s).strip('-')
    return s


def categorize(name: str, description: str) -> list[str]:
    """Determine template category from name/description."""
    text = f"{name} {description}".lower()
    for keyword, cats in CATEGORY_MAP.items():
        if keyword in text:
            return cats
    return ["productivity"]


def build_service_flow(connectors: list) -> list[str]:
    """Extract service names for the service_flow field."""
    flow = []
    name_map = {
        "gmail": "Gmail",
        "google": "Gmail",
        "notion": "Notion",
        "personas_database": "Local Database",
        "database": "Local Database",
        "personas_messages": "In-App Messaging",
        "personas_vector_db": "Vector Knowledge Base",
        "github": "GitHub",
        "slack": "Slack",
    }
    for c in connectors:
        svc_name = c.get("name", "") if isinstance(c, dict) else str(c)
        mapped = name_map.get(svc_name, svc_name.replace("_", " ").title())
        if mapped not in flow:
            flow.append(mapped)
    return flow or ["Local Database", "In-App Messaging"]


def build_triggers(agent_ir: dict) -> list[dict]:
    """Extract or generate triggers from agent_ir."""
    triggers = agent_ir.get("triggers", [])
    result = []
    for t in triggers:
        if isinstance(t, dict):
            result.append({
                "trigger_type": t.get("trigger_type", "manual"),
                "config": t.get("config", {}),
                "description": t.get("description", "Trigger"),
            })
    if not result:
        result.append({
            "trigger_type": "manual",
            "config": {},
            "description": "Run manually on demand",
        })
    return result


def build_connectors(agent_ir: dict) -> list[dict]:
    """Build connector-agnostic suggested_connectors from agent_ir."""
    raw = agent_ir.get("required_connectors", agent_ir.get("connectors", []))
    result = []
    for c in raw:
        if isinstance(c, dict):
            name = c.get("name", c.get("service_type", ""))
            result.append({
                "name": name,
                "label": name.replace("_", " ").title(),
                "auth_type": "api_key",
                "credential_fields": [],
                "setup_instructions": f"Configure {name} credentials in the Keys section.",
                "related_tools": ["http_request"],
                "role": c.get("purpose", "data access"),
                "category": "general",
            })
    return result


def build_notification_channels(agent_ir: dict) -> list[dict]:
    """Extract notification channels."""
    messages = agent_ir.get("messages", {})
    channels = messages.get("channels", [])
    result = []
    for ch in channels:
        if isinstance(ch, dict):
            result.append({
                "type": ch.get("channel", "built-in"),
                "description": ch.get("format", "status updates"),
                "config_hints": {"target": ch.get("target", "status")},
            })
    if not result:
        result.append({
            "type": "built-in",
            "description": "In-app status messages and reports",
            "config_hints": {"target": "status"},
        })
    return result


def build_event_subscriptions(agent_ir: dict) -> list[dict]:
    """Extract event subscriptions."""
    events = agent_ir.get("events", [])
    result = []
    if isinstance(events, list):
        for e in events:
            if isinstance(e, dict):
                result.append({
                    "event_type": e.get("event_type", "task_completed"),
                    "description": e.get("description", "Event"),
                })
    return result


def build_design_highlights(name: str, structured_prompt: dict) -> list[dict]:
    """Generate 4 design highlight categories."""
    return [
        {
            "category": "Intelligence",
            "icon": "brain",
            "color": "purple",
            "items": [
                "AI-powered analysis and classification",
                "Context-aware decision making",
                "Pattern recognition across data sources",
            ],
        },
        {
            "category": "Automation",
            "icon": "zap",
            "color": "blue",
            "items": [
                "End-to-end workflow execution",
                "Automatic data enrichment and processing",
                "Scheduled and event-driven triggers",
            ],
        },
        {
            "category": "Communication",
            "icon": "message-square",
            "color": "green",
            "items": [
                "Structured reports via in-app messaging",
                "Memory-based learning across runs",
                "Human review for critical decisions",
            ],
        },
        {
            "category": "Reliability",
            "icon": "shield",
            "color": "amber",
            "items": [
                "Graceful fallback on service unavailability",
                "Duplicate detection and idempotent processing",
                "Error logging and retry mechanisms",
            ],
        },
    ]


def build_use_case_flows(name: str, agent_ir: dict) -> list[dict]:
    """Generate use case flow diagrams."""
    use_cases = agent_ir.get("use_cases", [])
    flows = []
    for i, uc in enumerate(use_cases[:2]):
        title = uc.get("title", f"Flow {i+1}") if isinstance(uc, dict) else str(uc)
        desc = uc.get("description", title) if isinstance(uc, dict) else str(uc)
        flows.append({
            "id": f"flow_{i+1}",
            "name": title,
            "description": desc,
            "nodes": [
                {"id": "n1", "type": "start", "label": "Trigger", "detail": "Execution starts"},
                {"id": "n2", "type": "action", "label": "Process Data", "detail": "Analyze and enrich input"},
                {"id": "n3", "type": "decision", "label": "Needs Review?", "detail": "Check if human approval needed"},
                {"id": "n4", "type": "action", "label": "Generate Output", "detail": "Create report or take action"},
                {"id": "n5", "type": "event", "label": "Notify", "detail": "Send results via messaging"},
                {"id": "n6", "type": "end", "label": "Complete", "detail": "Store memory and finish"},
            ],
            "edges": [
                {"id": "e1", "source": "n1", "target": "n2"},
                {"id": "e2", "source": "n2", "target": "n3"},
                {"id": "e3", "source": "n3", "target": "n4", "label": "No", "variant": "no"},
                {"id": "e4", "source": "n3", "target": "n5", "label": "Yes", "variant": "yes"},
                {"id": "e5", "source": "n4", "target": "n5"},
                {"id": "e6", "source": "n5", "target": "n6"},
            ],
        })
    if not flows:
        flows.append({
            "id": "flow_1",
            "name": "Main Workflow",
            "description": f"Primary execution flow for {name}",
            "nodes": [
                {"id": "n1", "type": "start", "label": "Start"},
                {"id": "n2", "type": "action", "label": "Process"},
                {"id": "n3", "type": "end", "label": "Done"},
            ],
            "edges": [
                {"id": "e1", "source": "n1", "target": "n2"},
                {"id": "e2", "source": "n2", "target": "n3"},
            ],
        })
    return flows


def generate_template(persona: dict, agent_ir: dict) -> dict:
    """Generate a complete template JSON from persona + agent_ir data."""
    name = persona["name"]
    description = persona["description"] or f"{name} agent"
    slug = slugify(name)
    categories = categorize(name, description)
    primary_cat = categories[0]

    structured_prompt = agent_ir.get("structured_prompt", {})
    if isinstance(structured_prompt, str):
        try:
            structured_prompt = json.loads(structured_prompt)
        except:
            structured_prompt = {}

    # Build full_prompt_markdown from structured_prompt sections
    sections = []
    if structured_prompt.get("identity"):
        sections.append(f"## Identity\n\n{structured_prompt['identity']}")
    if structured_prompt.get("instructions"):
        sections.append(f"## Instructions\n\n{structured_prompt['instructions']}")
    if structured_prompt.get("toolGuidance"):
        sections.append(f"## Tool Guidance\n\n{structured_prompt['toolGuidance']}")
    if structured_prompt.get("examples"):
        sections.append(f"## Examples\n\n{structured_prompt['examples']}")
    if structured_prompt.get("errorHandling"):
        sections.append(f"## Error Handling\n\n{structured_prompt['errorHandling']}")
    full_prompt = f"# {name}\n\n" + "\n\n---\n\n".join(sections) if sections else f"# {name}\n\n{persona['system_prompt']}"

    connectors = build_connectors(agent_ir)
    service_flow = build_service_flow(agent_ir.get("required_connectors", agent_ir.get("connectors", [])))

    return {
        "id": slug,
        "name": name,
        "description": description,
        "icon": agent_ir.get("icon", ICON_MAP.get(primary_cat, "Zap")),
        "color": agent_ir.get("color", "#6366f1"),
        "category": categories,
        "service_flow": service_flow,
        "payload": {
            "service_flow": service_flow,
            "structured_prompt": {
                "identity": structured_prompt.get("identity", f"You are {name}, an intelligent automation agent."),
                "instructions": structured_prompt.get("instructions", persona["system_prompt"]),
                "toolGuidance": structured_prompt.get("toolGuidance", "Use http_request for API calls. Use built-in messaging for notifications."),
                "examples": structured_prompt.get("examples", f"Example: When triggered, {name} processes input data, generates insights, and delivers results via messaging."),
                "errorHandling": structured_prompt.get("errorHandling", "On service failure, log the error, retry once, and notify via messaging if the issue persists. Generate sample data as fallback."),
            },
            "suggested_tools": agent_ir.get("tools", ["http_request", "file_read", "file_write"]),
            "suggested_triggers": build_triggers(agent_ir),
            "full_prompt_markdown": full_prompt,
            "summary": description,
            "design_highlights": build_design_highlights(name, structured_prompt),
            "suggested_connectors": connectors,
            "suggested_notification_channels": build_notification_channels(agent_ir),
            "suggested_event_subscriptions": build_event_subscriptions(agent_ir),
            "use_case_flows": build_use_case_flows(name, agent_ir),
        },
    }


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # Get the 30 best personas with agent_ir data
    rows = conn.execute("""
        SELECT p.id, p.name, p.description, p.system_prompt, p.structured_prompt,
               p.icon, p.color, p.design_context, p.last_design_result,
               bs.agent_ir, bs.intent
        FROM personas p
        JOIN build_sessions bs ON bs.persona_id = p.id
        WHERE p.system_prompt != 'You are a helpful AI assistant.'
          AND bs.agent_ir IS NOT NULL
          AND (SELECT COUNT(*) FROM persona_executions WHERE persona_id = p.id AND status = 'completed') > 0
        ORDER BY length(bs.agent_ir) DESC
        LIMIT 30
    """).fetchall()

    conn.close()

    print(f"Generating templates for {len(rows)} personas...")
    generated = []

    for row in rows:
        try:
            agent_ir = json.loads(row["agent_ir"])
        except:
            print(f"  SKIP {row['name']}: invalid agent_ir JSON")
            continue

        persona = {
            "name": row["name"],
            "description": row["description"],
            "system_prompt": row["system_prompt"],
            "icon": row["icon"],
            "color": row["color"],
        }

        template = generate_template(persona, agent_ir)
        slug = template["id"]
        category = template["category"][0]

        # Write to disk
        cat_dir = TEMPLATES_DIR / category
        cat_dir.mkdir(parents=True, exist_ok=True)
        out_path = cat_dir / f"{slug}.json"

        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(template, f, indent=2, ensure_ascii=False)

        generated.append((slug, category, row["name"]))
        print(f"  [{len(generated):2}] {row['name'][:40]:<40} -> {category}/{slug}.json")

    print(f"\nGenerated {len(generated)} templates in scripts/templates/")
    return generated


if __name__ == "__main__":
    main()
