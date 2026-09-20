// The simulated-fleet barrel. Everything the board, the usage strip and the
// rail need to run on mock data, and nothing else — the fixtures themselves
// stay behind their own modules so a consumer cannot reach past the seam.

export { isTestBuild, setSimulation, toggleSimulation, useSimulationEnabled } from './simulationMode';
export { SimulationToggle } from './SimulationToggle';
export { simWorld, simQueueActions, useSimPlans, useSimQueue, type SimPlans, type SimWorld } from './useSimWorld';
export { useSimulatedBoard, type BoardInputs } from './useSimulatedBoard';
export { buildSimRail, type SimRailLabels, type SimRailRows } from './simRail';
export { buildSimBudgets, buildSimCliUsage } from './simPlans';
