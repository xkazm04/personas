import json, glob, os
root = os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'templates')
hits = []
for path in glob.glob(os.path.join(root, '**', '*.json'), recursive=True):
    with open(path, encoding='utf-8') as f:
        d = json.load(f)
    for q in (d.get('payload', {}).get('adoption_questions') or []):
        opts = q.get('options')
        if opts and any(isinstance(o, dict) for o in opts):
            rel = os.path.relpath(path, os.path.join(root, '..', '..')).replace(os.sep, '/')
            hits.append((rel, q.get('id'), type(opts[0]).__name__))
            break
print(f'{len(hits)} templates with object-shaped options')
for h in hits[:20]:
    print(' ', h)
