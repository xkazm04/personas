// The simulated-fleet barrel. Everything the board, the usage strip and the
// rail need to run on mock data, and nothing else — the fixtures themselves
// stay behind their own modules so a consumer cannot reach past the seam.

export { isTestBuild, setSimulation, toggleSimulation, useSimulationEnabled } from './simulationMode';
export { SimulationToggle } from './SimulationToggle';
export {
  simLoadFleet, simWorld, simQueueActions, useSimPlans, useSimQueue, type SimFleet, type SimPlans, type SimWorld,
} from './useSimWorld';
export { simHourlyRuns, SIM_HOURLY_WINDOW } from './simHourly';
export { SIM_LOAD_AGENTS_PER_PROJECT } from './simRandom';
export { useSimulatedBoard, type BoardInputs } from './useSimulatedBoard';
export { buildSimRail, type SimRailLabels, type SimRailRows } from './simRail';
export { SIM_VAULT_LOGINS, buildSimCliUsage } from './simPlans';
