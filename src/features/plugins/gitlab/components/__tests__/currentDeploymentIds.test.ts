import { describe, expect, it } from 'vitest';
import { currentDeploymentIds } from '../deploymentHistory';

// Newest first, as the backend returns a project's history.
const rec = (id: string, personaId: string) => ({ id, personaId });

describe('currentDeploymentIds', () => {
  it('marks the newest deployment of EACH persona current in a mixed list', () => {
    const history = [rec('d4', 'alpha'), rec('d3', 'beta'), rec('d2', 'alpha'), rec('d1', 'beta')];
    expect([...currentDeploymentIds(history)].sort()).toEqual(['d3', 'd4']);
  });

  it('marks exactly one current for a single-persona list', () => {
    const history = [rec('d2', 'alpha'), rec('d1', 'alpha')];
    expect([...currentDeploymentIds(history)]).toEqual(['d2']);
  });

  it('is empty for an empty history', () => {
    expect(currentDeploymentIds([]).size).toBe(0);
  });
});
