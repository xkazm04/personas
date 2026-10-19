import { describe, it, expect } from 'vitest';
import recipeIndex from '../recipeIndex.generated.json';
import { RECIPES } from '../useExploreCatalog';

describe('Explore recipe Tools column', () => {
  it('counts the connectors a v3 recipe declares', () => {
    // Index rows are generated from _recipe_seeds.json (v3, tool_requirements null).
    const rows = recipeIndex as { id: string; connectorTypes?: string[] }[];
    const declaring = rows.filter((r) => (r.connectorTypes?.length ?? 0) > 0);
    expect(declaring.length).toBeGreaterThan(0);

    const byId = new Map(RECIPES.map((r) => [r.id, r]));
    for (const r of declaring) {
      expect(byId.get(r.id)?.toolCount).toBe(r.connectorTypes!.length);
    }
  });
});
