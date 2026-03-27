# Codebase Init

Initialize any codebase for autonomous development by Dev Clone and QA Guardian personas. This skill performs a comprehensive one-time setup that establishes conventions, scans the tech stack, configures CI/CD, and creates the foundation for AI-assisted development.

## When to Use

Run this skill on a codebase BEFORE activating Dev Clone or QA Guardian personas. It creates the prerequisite configuration files, documentation, and scanning infrastructure they expect.

Can also be used standalone to bootstrap best practices in any new or existing project.

## Input

Ask the user: **"Which codebase should I initialize? Point me to the root directory and tell me what the project does."**

Wait for their response. Then execute all phases below.

---

## Phase 1: Tech Stack Detection

Automatically detect the project's technology stack by reading configuration files:

### Package Managers & Languages
- `package.json` → Node.js/TypeScript/JavaScript (check for `typescript` dep)
- `Cargo.toml` → Rust
- `requirements.txt` / `pyproject.toml` / `setup.py` → Python
- `go.mod` → Go
- `Gemfile` → Ruby
- `pom.xml` / `build.gradle` → Java/Kotlin

### Frameworks
- `next.config.*` → Next.js
- `vite.config.*` → Vite (React/Vue/Svelte)
- `remix.config.*` → Remix
- `nuxt.config.*` → Nuxt
- `angular.json` → Angular
- `django` in deps → Django
- `fastapi` in deps → FastAPI
- `actix-web` / `axum` in deps → Rust web framework
- `tauri.conf.json` → Tauri desktop app

### Testing
- `jest.config.*` → Jest
- `vitest` in deps → Vitest
- `pytest` in deps → pytest
- `cypress.config.*` → Cypress
- `playwright.config.*` → Playwright

### CI/CD
- `.github/workflows/` → GitHub Actions (read existing workflows)
- `.gitlab-ci.yml` → GitLab CI
- `Jenkinsfile` → Jenkins
- `circle.yml` / `.circleci/` → CircleCI

### Styling & UI
- `tailwind.config.*` → Tailwind CSS (read for brand colors)
- `src/styles/globals.css` → CSS custom properties
- Theme files → Design tokens

### Database
- `prisma/schema.prisma` → Prisma
- `drizzle.config.*` → Drizzle
- Supabase, PlanetScale, or other DB config files

**Output**: Print a summary of detected technologies:
```
Tech Stack Detected:
  Language:   TypeScript
  Framework:  Next.js 14 (App Router)
  Styling:    Tailwind CSS
  Database:   Prisma + PostgreSQL
  Testing:    Vitest + Playwright
  CI/CD:      GitHub Actions (2 workflows)
  Package Mgr: pnpm
```

---

## Phase 2: CLAUDE.md Generation

Create or update `.claude/CLAUDE.md` with project-specific conventions. This file is automatically loaded by Claude Code in every session.

### Structure

```markdown
# CLAUDE.md

## Project Overview
{Project name and what it does — from user input + package.json/README}

## Tech Stack
{Auto-detected from Phase 1}

## Common Commands

### Development
```bash
{detected dev command: npm run dev / cargo run / python manage.py runserver}
{detected build command}
{detected test command}
{detected lint command}
```

### Testing
```bash
{unit test command}
{e2e test command if applicable}
{coverage command}
```

## Architecture Overview
{Generated from directory structure analysis}
- `src/` — {purpose based on contents}
- `src/components/` or `src/features/` — {UI structure pattern}
- `src/lib/` or `src/utils/` — {shared utilities}
- `src/api/` or `src/routes/` — {API layer}
- `tests/` or `__tests__/` — {test organization}

## Code Conventions

### Naming
- Components: {PascalCase / kebab-case — detected from existing files}
- Files: {detected pattern}
- Variables: {camelCase / snake_case — detected from source}
- Test files: {*.test.ts / *.spec.ts — detected pattern}

### Patterns
- State management: {Zustand / Redux / Context — detected}
- Data fetching: {SWR / React Query / tRPC / fetch — detected}
- Error handling: {pattern detected from existing code}
- Styling approach: {Tailwind classes / CSS modules / styled-components}

### Import Conventions
- {Absolute imports via @ / relative imports — detected from tsconfig paths}
- {Import ordering convention — detected from existing files}

## Important Conventions
- {Any conventions detected from existing linting config (.eslintrc, .prettierrc)}
- {Commit message format from git log analysis}
- {Branch naming from git branch analysis}

## Do NOT
- Do not modify generated files (list auto-generated files detected)
- Do not commit .env files
- {Other anti-patterns detected from .gitignore}
```

### Detection Methods

For each section, use these strategies:
- **Commands**: Read `package.json` scripts, `Makefile`, `Cargo.toml`
- **Architecture**: `list_files` at top level and key directories, infer purpose from file names
- **Naming**: Read 5-10 source files, detect dominant patterns
- **Patterns**: `search_code` for import patterns, state management, data fetching
- **Conventions**: Read `.eslintrc*`, `.prettierrc*`, `tsconfig.json`, `.editorconfig`
- **Commit style**: `git log --oneline -20` to detect commit message conventions
- **Branch naming**: `git branch -r` to detect branch naming patterns

---

## Phase 3: Brand Manual (UI Projects Only)

If the project has a UI (detected via React, Vue, Svelte, Angular, or CSS framework):

### Extract Brand Identity

Read design configuration files to extract:

**Colors:**
- `tailwind.config.*` → `theme.extend.colors` or `theme.colors`
- CSS custom properties from `globals.css` or `:root` declarations
- Theme files (Material UI, Chakra, etc.)

**Typography:**
- Font families from CSS/Tailwind config
- Font loading from `next/font`, Google Fonts imports, or `@font-face`
- Heading/body size scales

**Components:**
- Detect component library: shadcn/ui, Radix, MUI, Chakra, Headless UI
- Detect icon library: Lucide, Heroicons, FontAwesome
- Detect animation library: Framer Motion, CSS transitions

**Write** `.claude/brand-manual.md`:
```markdown
# Brand Manual

## Colors
- Primary: {hex} — {usage context}
- Secondary: {hex}
- Accent: {hex}
- Background: {hex}
- Text: {hex}
- Error: {hex}
- Success: {hex}

## Typography
- Headings: {font-family}
- Body: {font-family}
- Code: {font-family}

## Component Library
- UI Kit: {shadcn/ui, MUI, Chakra, custom}
- Icons: {Lucide, Heroicons, etc.}
- Animations: {Framer Motion, CSS, none}

## Design Tokens
{Extracted spacing scale, border-radius values, shadow definitions}

## Visual Guidelines
- Corner radius: {detected default}
- Shadow style: {subtle, prominent, none}
- Spacing base: {4px, 8px — detected}
- Dark mode: {supported / not — detected from theme config}
```

---

## Phase 4: CI/CD Configuration

### If GitHub Actions exists:
- Read existing workflows
- Suggest additions if missing: lint, test, build, deploy
- Do NOT overwrite existing workflows

### If NO CI/CD exists:
Ask the user: "No CI/CD configuration detected. Should I create a GitHub Actions workflow?"

If yes, generate `.github/workflows/ci.yml` based on detected tech stack:

**For TypeScript/Node.js:**
```yaml
name: CI
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '{detected version}' }
      - run: {detected install command}
      - run: {detected lint command}
      - run: {detected test command}
      - run: {detected build command}
```

Adapt for Rust (cargo), Python (pytest), Go (go test), etc.

### Branch Protection Recommendations
Print recommendations:
```
Recommended GitHub Branch Protection for 'main':
  ✓ Require pull request reviews (1 reviewer minimum)
  ✓ Require status checks to pass (CI workflow)
  ✓ Require branches to be up to date
  ✓ Do not allow force pushes
  ✓ Do not allow deletions

Configure at: https://github.com/{owner}/{repo}/settings/branches
```

---

## Phase 5: Codebase Scan Configuration

Create initial scan configuration for the Dev Tools / Codebases connector:

### Generate Context Map
Analyze the project structure and create logical context groupings:
- **API Layer**: all route handlers, API endpoints, middleware
- **Data Layer**: database models, repositories, migrations
- **UI Layer**: components, pages, layouts (if applicable)
- **Business Logic**: services, utils, helpers
- **Configuration**: config files, environment, constants
- **Tests**: test files, fixtures, mocks

### Generate Initial Ideas Scan
Run a quick scan for common improvement areas:
- TODOs and FIXMEs in code
- Files without test coverage (files in `src/` without corresponding test files)
- Large files (>300 lines) that might benefit from splitting
- Deprecated dependency usage
- Console.log / print statements left in production code
- Missing error handling (try/catch around async operations)

Report findings:
```
Initial Codebase Scan:
  TODOs found: {N} across {M} files
  Files without tests: {N}
  Large files (>300 lines): {N}
  Console.log statements: {N}
  Missing error handling: {N} async calls without try/catch
```

---

## Phase 6: Dev Clone Readiness Checklist

Print a readiness checklist for activating Dev Clone:

```
Dev Clone Readiness Checklist:

  [✓] CLAUDE.md created with project conventions
  [✓] Tech stack detected and documented
  [✓/✗] Brand manual generated (UI projects only)
  [✓/✗] CI/CD configured
  [✓/✗] Branch protection recommendations reviewed
  [✓] Initial codebase scan completed
  [✓] Context map generated

  Prerequisites for Dev Clone activation:
  [ ] GitHub PAT configured with repo permissions
  [ ] Webhook configured (GitHub → Smee → Personas)
  [ ] Target repository and base branch confirmed
  [ ] Codebases connector has this project registered

  Prerequisites for QA Guardian activation:
  [ ] Separate GitHub PAT (different account recommended)
  [ ] Same webhook or event subscription configured
  [ ] Approve threshold and write_tests preference decided
```

---

## Notes

- This skill is designed to be **distributed manually** to any codebase. Copy the `.claude/skills/codebase-init/` directory to the target project.
- All generated files are placed in `.claude/` (CLAUDE.md, brand-manual.md) or standard locations (.github/workflows/).
- The skill never modifies source code — it only generates configuration and documentation.
- Re-running the skill is safe: it will update existing files rather than duplicating.
