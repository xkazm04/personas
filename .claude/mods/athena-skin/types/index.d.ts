export type Turn = { seconds: number; tools: number }

declare module 'claude-code' {
  interface PluginState {
    'athena-skin': { last: Turn | null; working: boolean }
  }
}
