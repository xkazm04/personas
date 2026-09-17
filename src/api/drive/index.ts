// IPC client for the Drive plugin — a managed LOCAL filesystem sandbox.
// Split by theme (drive-finder spark, 2026-09-17): `fs` = the original
// listing / read / write / mutate surface, `meta` = the tag index, `transfer`
// = duplicate / import / export / drag-out. Callers keep importing
// `@/api/drive`.
export * from "./fs";
export * from "./meta";
export * from "./transfer";
