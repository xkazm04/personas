import { ArenaPanelColosseum } from './ArenaPanelColosseum';

export interface ArenaVersionScope {
  versionId: string;
  versionNumber: number;
}

/** `versionScope` measures a specific prompt version (the Lab table's Measure
 *  action mounts this in a modal); omit it to measure the persona's current prompt. */
export function ArenaPanel({ versionScope }: { versionScope?: ArenaVersionScope } = {}) {
  return <ArenaPanelColosseum versionScope={versionScope} />;
}
