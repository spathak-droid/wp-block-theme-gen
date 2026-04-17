# wp-block-theme-gen

AI-powered WordPress Block Theme Generator. Produces valid, installable FSE Block Themes (`theme.json` v3, block markup templates, PHP patterns) from a user prompt — with **zero `core/html` blocks**.

> Status: Phase 0 (scaffold). See `presearch.md` and `PRD.md` for the full plan.

## What this does

User enters a prompt ("minimalist photography portfolio"). The app:

1. Plans a coherent style profile (typography voice, 8-color palette, 7-spacing scale, 3 section styles) via Claude Sonnet 4.6.
2. Generates 8–12 templates and 15–25 patterns via Claude Haiku 4.5 with Anthropic Structured Outputs.
3. Validates every block at three tiers: schema (decode), parse/serialize round-trip, semantic lint.
4. Previews the live theme in-browser via WordPress Playground (WASM).
5. Lets the user refine via chat and download a ZIP.

Themes install cleanly via Appearance → Themes → Upload Theme (or `wp theme install`).

## Why "zero `core/html`"

The Custom HTML block is an escape hatch that trivializes the problem — emitting raw HTML wrapped in one block. This project enforces proper block composition through four layers: Zod enum, system-prompt allowlist, semantic lint, and Playground smoke test.

## Quick start

Requires Node.js 22+.

```bash
npm install
cp .env.example .env.local          # then add your ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000.

## Commands

```bash
npm run dev              # Next.js dev server
npm run build            # Production build
npm run start            # Production server
npm run lint             # ESLint
npm run typecheck        # tsc --noEmit
npm run format           # Prettier write
npm run format:check     # Prettier check
npm test                 # Vitest (unit + integration)
npm run test:watch       # Vitest watch
```

## Documentation

- [`presearch.md`](./presearch.md) — full architecture decisions with rationale (Loops 0–6)
- [`PRD.md`](./PRD.md) — phased implementation plan (11 phases, ~8 working days)
- [`CLAUDE.md`](./CLAUDE.md) — project conventions
- [`dev-docs/research-brief.md`](./dev-docs/research-brief.md) — Loop 0 research findings with sources
- `docs/adr/*` — Architecture Decision Records (added Phase 10)

## Tech stack

Next.js 16 · React 19 · TypeScript 5 (strict) · Tailwind 4 · shadcn/ui · Zustand · Anthropic SDK · Zod · AJV · `@wordpress/block-serialization-default-parser` · `@wp-playground/cli` · JSZip · Vitest 3 · Playwright · ESLint · Prettier · Vercel · GitHub Actions.

## License

MIT
