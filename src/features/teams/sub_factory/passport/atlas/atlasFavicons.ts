// slug -> favicon data URL for the Atlas figure's project tiles. ProjectsLayer
// probes each repo once per session (its FAVICON_CACHE) and provides the map
// here; the figure contract (atlasFigure.ts) stays the data model's alone, so
// this travels by context rather than as a prop through PassportAtlas.
import { createContext } from 'react';

export const AtlasFavicons = createContext<Map<string, string>>(new Map());
