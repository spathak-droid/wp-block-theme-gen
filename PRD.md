# PRD — AI-Powered WordPress Block Theme Generator

**Status:** Locked 2026-04-17 after Presearch v2 Loops 0–6
**Companion docs:** `presearch.md`, `dev-docs/research-brief.md`, `CLAUDE.md`

---

## Product Summary

A Next.js + TypeScript web app. User enters a prompt ("minimalist photography portfolio"). App produces a downloadable, installable WordPress Block Theme (FSE, theme.json v3) composed entirely of core blocks — never `core/html`. Live preview in WordPress Playground, chat-based refinement, side-panel block inspector.

## Non-negotiables

1. **Zero `core/html` blocks** in any generated file. Four enforcement layers.
2. **100% valid, runnable themes** — passes Playground smoke test.
3. **Structured AI output** via Anthropic Structured Outputs + flat IR (not recursive tree).
4. **3-tier validation** (Zod schema, parse/serialize round-trip, semantic lint) + 2-retry repair loop.
5. **Preset-variable enforcement** — no hex colors, no raw px in theme.json or templates.

## Stack (locked)

- Next.js 15 (App Router) + React 19 + TypeScript 5.9 strict
- Tailwind 4 + shadcn/ui + Zustand
- Node.js 22 runtime
- Anthropic SDK (Sonnet 4.6 planner, Haiku 4.5 executors/repair, Sonnet 4.6 escalation)
- `@wordpress/block-serialization-default-parser` + Zod 4 + AJV
- `@wp-playground/cli` (CI smoke) + Playground WASM (iframe preview)
- JSZip, Vitest 3, Playwright
- Vercel deploy, GitHub Actions CI

## Phased Plan

### Phase 0 — Scaffold & Infra (≤0.5d)

- [ ] Next.js 15 + TS strict + Tailwind 4 + ESLint flat + Prettier + Vitest
- [ ] `ANTHROPIC_API_KEY` env handling
- [ ] GitHub Actions: lint + typecheck + test on PR
- [ ] shadcn/ui initialized
- [ ] Vercel project linked
- [ ] CLAUDE.md, README.md, LICENSE stubs
- [ ] `dev-docs/research-brief.md`, `presearch.md`, `PRD.md` in repo

**Tests:** 3 (smoke, lint, typecheck pass)
**Acceptance:** `npm run dev` renders blank Next.js; CI green on PR
**PR #1.** Innovations: none.

---

### Phase 1 — Block Taxonomy & IR Core (1d)

- [ ] `src/lib/blocks/taxonomy.ts` — 35-block enum (excludes `core/html`). Each has: `{isVoid, acceptsInnerBlocks, knownAttrs: Zod}`
- [ ] `src/lib/ir/schema.ts` — flat IR Zod: `IRToken = open | close | void | text`
- [ ] `src/lib/ir/serialize.ts` — IR → block markup
- [ ] `src/lib/ir/parse.ts` — wrapper over `@wordpress/block-serialization-default-parser`
- [ ] `src/lib/ir/roundTrip.ts` — `serialize(parse(x)) === x`
- [ ] `src/lib/ir/lint.ts` — semantic rules (no `core/html`, no hex, no raw px, void w/o closer, orphan columns, `core/query` has `post-template`)

**Tests (20+):**
- Round-trip for each of 35 blocks
- 5 Twenty Twenty-Five few-shots round-trip identically
- Lint rejects: `core/html` direct+nested, hex, raw px, orphan columns, void-with-closer, missing `core/post-template`
- Zod rejects unbalanced token sequences

**Acceptance:** 5 few-shots round-trip and lint-pass; synthetic bad inputs fail with specific errors.
**PR #2.** Innovations: **I11** (block-variation-aware IR).

---

### Phase 2 — theme.json Inference & StyleProfile (1d)

- [ ] `src/lib/style/profile.ts` — StyleProfile Zod
- [ ] `src/lib/style/themeJson.ts` — StyleProfile → theme.json v3 (8-color palette, 5 fluid font sizes, 7 spacing presets, 3 section styles, `appearanceTools: true`)
- [ ] AJV validator against bundled `schemas.wp.org/trunk/theme.json`
- [ ] `src/lib/style/css.ts` — style.css header builder
- [ ] `src/lib/theme/filesystem.ts` — assemble `/style.css`, `/theme.json`, `/templates/`, `/parts/`, `/patterns/`, `/functions.php` (registers pattern categories), `/screenshot.png` placeholder

**Tests (15+):**
- StyleProfile → AJV-valid theme.json
- Preset slugs referenced in spacing/color exist
- Contrast edge (dark/light palette)
- Fluid scale monotonic
- Section-style `variations` valid

**Acceptance:** coherent StyleProfile → theme.json that validates + reads as sensible.
**PR #3.** Innovations: **I9** (theme.json preset inference), **I10** (pattern taxonomy alignment).

---

### Phase 3 — Anthropic Client & Prompt Infrastructure (0.5d)

- [ ] `src/lib/ai/client.ts` — Anthropic SDK init + env validation
- [ ] `src/lib/ai/systemPrompt.ts` — 12k-token cached prefix (block grammar + 35-block allowlist + 5 few-shots + preset rule + no-`wp:html` rule, `cache_control: ephemeral`)
- [ ] `src/lib/ai/withRetry.ts` — exponential backoff, 3 attempts
- [ ] `src/lib/ai/models.ts` — router by task
- [ ] `src/lib/ai/costTrack.ts` — per-call token + $ log

**Tests (8+):**
- System prompt token count ≤16k
- Router returns correct model per task
- Retry on mock 5xx
- Cost tracker sums correctly

**Acceptance:** test Haiku call with cached prompt returns schema-valid output <5s, cost <$0.001.
**PR #4.** Innovations: **I12** (tiered routing), **I13** (prompt caching).

---

### Phase 4 — Planner (StyleProfile + ThemePlan) (1d)

- [ ] `src/lib/ai/planner.ts` — Sonnet 4.6 with `StylePlan` Structured Output
- [ ] Prompt: commit to style voice; list 8–12 templates + 15–25 patterns with slugs + purpose + placeholder copy directives
- [ ] ThemePlan consistency: required templates (index, single, archive, 404) + template-part ↔ parts consistency
- [ ] Multi-direction: 3 parallel planner calls → 3 directions with distinct StyleProfiles

**Tests (10+):**
- 5 diverse prompts → schema-valid output
- ThemePlan always includes index, page, single, 404, archive, header, footer
- Multi-direction returns 3 distinct StyleProfiles
- Ambiguous prompt → normalized (no contradictions)

**Acceptance:** "minimalist photography portfolio" → editorial voice + muted palette + serif heading + 10 templates.
**PR #5.** Innovations: **I1** (style-profile commit), **I6** (multi-direction).

---

### Phase 5 — Template & Pattern Generators (1.5d)

- [ ] `src/lib/ai/templateGen.ts` — Haiku 4.5 per template → `TemplateIR`
- [ ] `src/lib/ai/patternGen.ts` — Haiku 4.5 per pattern → IR + metadata (title, slug, categories)
- [ ] `src/lib/ai/orchestrator.ts` — plan → fan out with `p-limit(4)` → serialize → validate → retry (cap 2) → Sonnet escalation on 2× fail
- [ ] `src/lib/ai/repair.ts` — (originalIR, errorMsg) → correctedIR
- [ ] Pattern PHP wrapper — header comment + markup body

**Tests (20+):**
- 5 plans → schema-valid IR across all templates
- Serialized output round-trips
- First-pass lint ≥95%
- Repair produces fixed IR
- Escalation triggers on 2× Haiku fail
- Pattern PHP header valid
- `core/html` never appears across 50 generations (integration)

**Acceptance:** prompt → full theme dir, AJV + lint + round-trip all pass.
**PR #6.**

---

### Phase 6 — Playground Smoke Test & CI (0.5d)

- [ ] `src/lib/validate/playground.ts` — programmatic `@wp-playground/cli` runner (Blueprint: installTheme → activate → goto home → assert no PHP error)
- [ ] `tests/smoke/playground.test.ts` — Vitest slow suite
- [ ] GitHub Actions: nightly smoke + per-PR fast suite
- [ ] `npm run self-test` — generator self-test asserting zero `core/html` (per Patch G7)

**Tests (3+ smoke):**
- Minimalist portfolio activates + renders
- Bold SaaS landing activates + renders
- Editorial blog activates + renders

**Acceptance:** 3 smokes pass.
**PR #7.**

---

### Phase 7 — ZIP Packaging & File Server (0.5d)

- [ ] `src/lib/package/zip.ts` — JSZip streaming ZIP (single top-level folder = theme slug)
- [ ] `app/api/download/[id]/route.ts` — ZIP stream with correct headers
- [ ] `app/api/preview/[id]/[...path]/route.ts` — serves files for Playground iframe
- [ ] Slug sanitizer (lowercase, hyphens, reject "wordpress"/"gutenberg" per Patch G5)

**Tests (8+):**
- ZIP has theme-slug/ at root
- Unpacked ZIP = filesystem dir (byte-match)
- Slug sanitization
- Download headers correct
- Preview endpoint correct content-type per file

**Acceptance:** `wp theme install ./downloaded.zip` succeeds.
**PR #8.**

---

### Phase 8 — UI: Prompt, Preview, Download (1d)

- [ ] `app/page.tsx` — prompt textarea + genre chips + submit
- [ ] SSE client handling events: `plan-ready`, `direction-choices`, `direction-chosen`, `template-ready`, `pattern-ready`, `validation-retry`, `validating`, `ready`, `error` (per Patch G1)
- [ ] Playground iframe component with loading skeleton; parallel boot on page load
- [ ] Progress indicator (planning → generating → validating → ready)
- [ ] Download button (enabled on ready)
- [ ] Multi-direction: 3 StyleProfile cards post-planning; user picks one
- [ ] Zustand session store

**Tests (10+):**
- SSE events fire in order
- Playground iframe loads generated theme
- Download triggers ZIP
- Direction card selection advances flow
- Empty prompt disables submit
- Error → retry button

**Acceptance:** prompt → download happy path <90s.
**PR #9.** Innovations: **I3** (Playground preview), **I4** (progressive streaming), **I6** (multi-direction UI).

---

### Phase 9 — Block Inspector & Chat Refinement (1d)

- [ ] Right-rail: collapsible file tree + syntax-highlighted read-only code viewer
- [ ] Chat component
- [ ] `app/api/refine/route.ts` — Sonnet 4.6 plans minimal edit → regenerates only affected templates
- [ ] Chat history in Zustand (session-scoped)

**Tests (10+):**
- File tree renders all files
- Code viewer shows correct markup per file
- "Warmer palette" → theme.json regenerates with warm colors
- "Bigger hero" → only index.html regenerates
- Chat history persists

**Acceptance:** user inspects every file as block markup; successfully refines 3× without full regen.
**PR #10.** Innovations: **I14** (block inspector).

---

### Phase 10 — Polish: README, ADRs, "What I'd Do Next" (0.5d)

- [ ] README.md — what/why/run/test/screenshots
- [ ] `docs/adr/0001-json-ir-not-direct-markup.md`
- [ ] `docs/adr/0002-flat-token-stream-not-recursive-tree.md`
- [ ] `docs/adr/0003-tiered-model-routing.md`
- [ ] `docs/adr/0004-playground-as-validation-oracle.md`
- [ ] `docs/adr/0005-no-wp-html-enforcement-layers.md`
- [ ] `docs/what-id-do-next.md` — limitations + roadmap
- [ ] Final CLAUDE.md pass

**Acceptance:** reader of only README + ADRs understands full architecture.
**PR #11.** Innovations: **I15** ("What I'd Do Next" ADR).

---

## Phase Dependency Map

```
Phase 0 (Scaffold)
  └── Phase 1 (IR Core)
       └── Phase 2 (theme.json) + Phase 3 (AI client)    [parallel]
            └── Phase 4 (Planner)
                 └── Phase 5 (Template/Pattern Gen)
                      └── Phase 6 (Playground Smoke)
                           └── Phase 7 (ZIP/File Server)
                                └── Phase 8 (UI)
                                     └── Phase 9 (Inspector + Chat)
                                          └── Phase 10 (Docs)
```

**Total estimated effort: ~8 working days.**

---

## MVP Validation Checklist

| # | Requirement | Phase | Innovation | Test |
|---|---|---|---|---|
| M1 | Valid runnable theme | 6 | — | Playground smoke |
| M2 | Zero `core/html` | 1, 5 | I11 | Lint + 50-gen integration |
| M3 | Structured AI output | 3, 4, 5 | I12 | Schema validation |
| M4 | Robust validation | 1, 5 | — | 3-tier pipeline |
| M5 | Tests pass | all | — | 104+ tests |
| M6 | Clean code | all | — | ESLint strict |
| M7 | Commit history | all | — | Conventional commits |
| M8 | README + ADR + Next | 10 | I15 | Artifact presence |
| R1 | Non-generic | 2, 4, 5 | I1, I9, I10 | Manual review + heuristic |
| R2 | Sophisticated blocks | 1, 5 | I11 | Integration (Query Loop per theme) |
| R3 | Thoughtful prompts | 3, 4, 5 | I1, I12, I13 | Validity rate ≥95% |
| R4 | Architectural ADRs | 10 | I15 | 5 ADRs |
| R5 | What I'd Do Next | 10 | I15 | Doc artifact |

---

## Innovation Tracking

| # | Innovation | Class | Phase |
|---|---|---|---|
| I1 | Style-profile commit step | CORE | 4 |
| I3 | Live Playground preview | CORE | 8 |
| I4 | Progressive streaming | CORE | 8 |
| I6 | Multi-direction generation | CORE | 4, 8 |
| I9 | theme.json preset inference | CORE | 2 |
| I10 | Pattern taxonomy alignment | CORE | 2 |
| I11 | Block-variation-aware IR | CORE | 1 |
| I12 | Tiered model routing | CORE | 3 |
| I13 | Aggressive prompt caching | CORE | 3 |
| I14 | Side-panel block inspector | CORE | 9 |
| I15 | "What I'd Do Next" ADR | CORE | 10 |
| I5 | Element-click refinement | STRETCH | 11 |
| I2 | Visual-reference grounding | STRETCH | 12 |
| I7 | Validator npm package | STRETCH | 13 |
| I8 | Observability dashboard | CUT | — |

---

## Stretch Goals (post-MVP, ordered)

1. **I5** — Element-click refinement (~1d)
2. **I2** — Visual-reference grounding (~0.5d)
3. **I7** — Validator npm package (~0.5d)
4. Server-side screenshot fallback (~0.5d)

---

## Out of Scope (explicit)

- User accounts, saved themes, payment/subscription
- Theme marketplace or sharing
- Plugin generation
- Classic (PHP-template) themes
- WooCommerce / e-commerce-specific templates
- Multi-site / network support
- i18n beyond English
- Accessibility audits beyond core-block defaults
- Pre-existing theme upload-to-edit (per Patch G4)
