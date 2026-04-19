"""Categorize incomplete templates by actual root cause."""
import json, pathlib

with open('tools/test-mcp/reports/c2-sweep-20260419_125431.json') as f:
    sweep = json.load(f)

incomplete = [r for r in sweep['results'] if r['grade'] in ('F', 'D')]
print(f"Total incomplete (F+D): {len(incomplete)}\n")

buckets = {
    "blocked_vault_questions":     [],
    "hang_initializing_no_vault":  [],
    "failed_adoption_opens":       [],
    "designcontext_missing_ucs":   [],
    "promote_failed":              [],
    "test_agent_error":            [],
    "other":                       [],
}

for r in incomplete:
    checks = {c['id']: c for c in r['checks']}
    try:
        with open(r['path'], encoding='utf-8') as ftf:
            t = json.load(ftf)
        qs = t.get('payload', {}).get('adoption_questions') or []
        vault_qs = [q for q in qs if q.get('vault_category')]
    except Exception:
        qs, vault_qs = [], []

    if not checks.get('adoption_opens', {}).get('passed', True):
        buckets['failed_adoption_opens'].append(r)
    elif not checks.get('persona_created', {}).get('passed', True):
        if vault_qs:
            buckets['blocked_vault_questions'].append((r, len(vault_qs), len(qs)))
        else:
            buckets['hang_initializing_no_vault'].append((r, len(qs)))
    elif not checks.get('persona_promoted', {}).get('passed', True):
        buckets['promote_failed'].append(r)
    elif not checks.get('test_agent_runs', {}).get('passed', True):
        buckets['test_agent_error'].append(r)
    elif not checks.get('design_context_has_use_cases', {}).get('passed', True):
        buckets['designcontext_missing_ucs'].append(r)
    else:
        buckets['other'].append(r)

for name, items in buckets.items():
    print(f"=== {name}: {len(items)} templates ===")
    for item in items[:8]:
        if isinstance(item, tuple):
            if len(item) == 3:
                rr, vn, tn = item
                print(f"  {rr['display_name']:50s} ({rr['category']:15s}) vault_qs={vn}/{tn}")
            else:
                rr, n = item
                print(f"  {rr['display_name']:50s} ({rr['category']:15s}) questions={n}")
        else:
            print(f"  {item['display_name']:50s} ({item['category']:15s})")
    if len(items) > 8:
        print(f"  ... +{len(items)-8} more")
    print()

# Vault category frequency — which categories are blocking most often?
print("=== Blocking vault_category distribution ===")
cat_freq = {}
for r, _, _ in buckets['blocked_vault_questions']:
    try:
        with open(r['path'], encoding='utf-8') as ftf:
            t = json.load(ftf)
        for q in (t.get('payload', {}).get('adoption_questions') or []):
            vc = q.get('vault_category')
            if vc:
                cat_freq[vc] = cat_freq.get(vc, 0) + 1
    except Exception:
        pass
for vc, n in sorted(cat_freq.items(), key=lambda x: -x[1]):
    print(f"  {vc}: {n}")
