# Personas - house profile

Read by `/lens-scan` phase 0 (ai-registry `skills/lens-scan/references/house.md`). A section left as
TODO means the scan makes no assumption for it and says so. Fill these in; they keep scan outcomes in
touch with the product.

## Users

TODO: who uses Personas, their expertise, the devices and screen sizes they work on, accessibility needs.

## Industry

TODO: the domain and any regulation that applies (data handling, credentials, model providers).

## Constraints

TODO: supported platforms, performance budgets (startup, screen transitions), severity definitions for
security findings, data residency.

## Brand

TODO: voice, the design-system source, where the tokens live.

## Stack

Local desktop app: Tauri 2 with a Rust workspace (`src-tauri/{core,db,engine,macros}`) and a React 19 +
Vite + Tailwind 4 + zustand frontend. Not deployed as a web app; local SQLite storage.
