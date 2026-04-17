# Research Brief — AI-Powered WordPress Block Theme Generator

**Date:** 2026-04-17
**Mode:** Greenfield
**Research phase:** Loop 0 (pre-architecture)
**Confidence in findings:** High across tech/AI/competitive — low on WP-LLM accuracy and exact model quality gap (flagged as needing internal bench)

---

## 1. What we're building (for context)

A standalone AI assistant. Input: a user prompt ("minimalist photography portfolio", "modern SaaS landing page"). Output: a downloadable `.zip` WordPress Block Theme (FSE, theme.json v3, block markup templates + parts + patterns) that installs cleanly, renders without PHP errors, and is **composed entirely of core blocks — never `core/html`**.

Evaluation rubric includes: valid runnable theme, zero `wp:html`, reliable structured AI output, robust validation, tests, clean code, README/ADR/"What I'd do next," and (raises-the-bar) sophisticated visual output + non-generic style.

---

## 2. High-confidence findings that reshape the design

### F1. Anthropic Structured Outputs does not support recursive schemas
Block markup is an arbitrarily-nested tree (Group > Columns > Column > Group > Heading). Anthropic's strict-schema Structured Outputs explicitly disallows recursion and caps optional params at 24. OpenAI has a 5-level nesting limit. **This rules out the obvious "one big recursive JSON schema" approach.**

**Two viable schemas:**
- **A. Bounded-depth tree** — define InnerBlock1{children:InnerBlock2[]}… up to 4 levels, clamp deeper content
- **B. Flat token stream** — `[{kind:"open", block, attrs}, {kind:"text"}, {kind:"close"}]` — trivially validatable, no recursion
- **Leaning B.** Simpler to validate, no depth clamp, composes with the WP canonical parser's tree output.

### F2. Direct markup generation fails; JSON IR + serializer succeeds
- Tasselli (DEV.to): direct HTML generation 8–12% error rate → JSON IR + schema <1%.
- Bossenger (Apr 2026, Claude-built block theme): needed 9 commits to manually convert `<!-- wp:html -->` soup back into real blocks.
- **Decision implication:** LLM emits JSON IR (token stream). Our code serializes IR → block markup → round-trips through `@wordpress/block-serialization-default-parser`. No `core/html` in the IR's `block` enum, period.

### F3. WordPress Playground is the validation oracle we want
- `@wp-playground/cli` runs PHP-WASM + SQLite WordPress in Node, no Docker.
- Install theme → activate → GET homepage → assert no `wp-die` / PHP notice markers.
- Works in CI. This catches 95% of structural errors for cheap.
- As of Feb 2026, `wp-env` itself supports `--runtime=playground`.
- Huge credibility signal for Automattic reviewers — it's their own project.

### F4. Default theme Twenty Twenty-Five is the gold standard, not a style guide we need to invent
- 98 patterns organized into 12 categories (banner, cta, footer, gallery, header, hero, pages, posts, services, testimonials, text, contact).
- Uses **preset variables everywhere** (`var:preset|spacing|50`, `var:preset|color|accent-2`) — hardcoded hex/px = instant "AI generic" tell.
- Signature moves to learn from: (a) `layout.type: "grid"` with `minimumColumnWidth:"19rem"` for responsive auto-grids, (b) `is-style-section-N` classes to re-theme whole sections, (c) poster-scale `clamp()` typography inline, (d) template-part variants for interchangeable headers/footers.
- **Five canonical snippets extracted from the repo** will be our few-shot corpus (see §7).

### F5. Model routing for cost and quality
2026 pricing per MTok:
| Model | In | Out | Cache read | Cache write (5m) |
|---|---|---|---|---|
| Opus 4.7 | $5 | $25 | $0.50 | $6.25 |
| Sonnet 4.6 | $3 | $15 | $0.30 | $3.75 |
| Haiku 4.5 | $1 | $5 | $0.10 | $1.25 |

- Haiku 4.5 min-cacheable prefix: 4,096 tokens. Sonnet 4.6: 2,048.
- **Opus 4.7 tokenizer inflates ~35%** on same text vs earlier Claude — easy to miss in budgets.
- Multi-agent orchestration: 4–7× tokens vs single-agent.
- **Proposed routing:** Sonnet 4.6 as planner (once per theme) → Haiku 4.5 per-template generator (5–15 calls) → Haiku 4.5 as validator/repair. Opus 4.7 only if Sonnet planning proves insufficient.
- **Prompt caching target:** 8–16k-token system prefix (block grammar + allowlist + few-shots). Caching gives ~87% input-cost reduction on the static prefix across a 50-call session.

### F6. Competitive gap is real
- ZipWP / Hostinger / 10Web / Divi / Elementor AI: all generate **live hosted sites** on page-builders — none produces a native downloadable block theme ZIP.
- Telex (Automattic's own, Sept 2025): experimental, can generate block themes in late 2025/early 2026, admits inconsistent quality, still fragile with nested blocks.
- WP-LLM: closed-source 70B fine-tune, no public benchmarks, not reproducible.
- **No open-source "LLM → valid block theme ZIP" pipeline exists.** We have the lane.

### F7. Validation retry loops are table stakes
Industry pattern: generate → parse → if invalid, feed exact error back → retry. 2–3 retries is the cap. Intrinsic self-critique (without external validator) doesn't work; only external validators (parser, schema, linter) help. Recovers up to 90% of initially-failed batches.

---

## 3. Failure modes we know about in advance

From Bossenger, Brian Coords, and WordCamp 2024-2026 talks:

| # | Failure mode | Mitigation |
|---|---|---|
| 1 | LLM emits `<!-- wp:html -->` for hard cases | Hard-ban in schema enum + linter + few-shots only show correct composition |
| 2 | Hardcoded colors/spacing (`padding:40px`, `#FF5733`) | Lint-reject any hex or raw px; require preset variables |
| 3 | Div soup — 4+ deep `wp:group` nesting with no purpose | Depth limit + semantic review |
| 4 | Duplicate CSS between `theme.json` and `style.css` | `style.css` = metadata only; all styling via `theme.json` |
| 5 | Missing `$schema` or wrong `version` in theme.json | Template-scaffolded `theme.json` with correct version=3 |
| 6 | Fixed headers without `.admin-bar` offset | Not a blocker for MVP (cosmetic) |
| 7 | Classic-theme-era patterns (2010s PHP templating) | Few-shot corpus from Twenty Twenty-Five only |
| 8 | `patterns/*.html` instead of `.php` (silently ignored) | Scaffold step emits PHP with header comment |
| 9 | `core/template-part` slug doesn't match a file in `/parts/` | Validator cross-checks slugs against generated parts |
| 10 | Void blocks written with closing tag (e.g. `<!-- wp:site-title --><!-- /wp:site-title -->`) | Block taxonomy knows which blocks are void; enforce self-closing |

---

## 4. Tech stack candidates (locked in Loop 2, listed here for continuity)

- **Frontend:** Next.js 15 + React + Tailwind. Rationale: WP ecosystem is React-native; Automattic reviewers will recognize it; `@wordpress/*` packages run best in Node.
- **Backend/runtime:** Node/TypeScript. Rationale: we need `@wordpress/block-serialization-default-parser` and `@wp-playground/cli` — both are JS. No PHP server needed.
- **AI:** Anthropic SDK, Claude models above. Structured Outputs (GA).
- **Validation:** `@wordpress/block-serialization-default-parser` + AJV (for theme.json against schemas.wp.org) + custom lint rules + `@wp-playground/cli` smoke test.
- **Packaging:** JSZip (Node).
- **Storage:** filesystem for generated themes (MVP); no DB needed.
- **Preview:** WordPress Playground in iframe (browser) for user-facing live preview.

---

## 5. Key constraints discovered by research (not in original brief)

1. `core/row` and `core/stack` are **variations** of `core/group`, not distinct block types. Serializer must emit `core/group` with `layout.type:"flex"` + `orientation`.
2. `core/navigation` needs either a `ref` (menu ID) or nested `core/navigation-link` children — we'll use the latter in generated themes since we can't pre-populate menu IDs.
3. `patterns/` directory files must be `.php` with a specific header comment (`Title:`, `Slug:`, `Categories:`). HTML files are silently ignored.
4. `core/query` requires a child `core/post-template` — omitting it = empty render.
5. `theme.json` v3 requires WordPress 6.6+ in `style.css`'s `Requires at least:` header.
6. Folder slug rules: lowercase, hyphens, ASCII only, no leading digit.
7. Anthropic Structured Outputs caches the grammar separately (24h). Changing the schema invalidates cache — lock it per session.

---

## 6. Evaluation criteria mapping preview

| Must-have | Already addressed by design |
|---|---|
| Valid runnable WordPress Block Theme | Playground-CLI smoke test in validator loop |
| Zero `core/html` | Schema enum excludes it + lint + few-shot discipline |
| Structured AI output | Anthropic Structured Outputs (flat IR) + serializer + round-trip parse |
| Robust validation | Three-tier: decode-time, parse-time round-trip, semantic lint |
| Tests passing | Vitest for unit (IR serializer, linter, validator) + Playground smoke test for themes |
| Clean code | TypeScript strict, ESLint, Prettier, small modules |
| Strong commit history / PR discipline | Conventional commits, one PR per phase |
| README / ADR / "What I'd Do Next" | Scaffolded as artifacts |

| Raises-the-bar | Planned treatment |
|---|---|
| Visually high-quality, non-generic | Style-profile step (typography voice + color system + spacing scale) BEFORE markup generation; 15–25 patterns per theme; section-level `is-style-*` alternation |
| Sophisticated block usage | Few-shot corpus extracted from Twenty Twenty-Five (grid layout, Query Loop, clamp typography, layered Cover, section styles) |
| Thoughtful prompt engineering | Layered defense: schema enum + allowlist + few-shot + validator retry + style-profile commit step |
| Product/architectural ADR | ADRs on: (1) JSON IR vs direct markup, (2) model routing, (3) validation oracle (Playground) |

---

## 7. Canonical few-shot snippets (from Twenty Twenty-Five)

These five snippets get baked into the system prompt as the grounding corpus. All pulled directly from the wordpress/twentytwentyfive repo; all preset-only, zero hardcoded values, zero `wp:html`.

**(1) CTA Centered (hero block)** — Group/heading/paragraph/buttons composition, preset spacing/color.

**(2) Responsive Grid** — `layout.type:"grid"` with `minimumColumnWidth:"19rem"` — THE modern auto-grid pattern.

**(3) Poster-Scale Heading** — inline `clamp()` typography for editorial feel.

**(4) Section-Styled Wrapper** — `is-style-section-3` class for re-themed sections (alternating contexts).

**(5) Query Loop Grid** — canonical posts-grid with featured image + title + excerpt + date + pagination.

(Full markup in `dev-docs/few-shot-corpus.md` — to be extracted during Phase 1 scaffold.)

---

## 8. Unresolved questions (feed into Loop 1/2)

- **U1.** Frontend hosting target — Vercel (standard for Next.js) vs Railway (aligns with our default)?
- **U2.** Preview: Playground in iframe (client-side WASM) is heavy first-load. Do we accept that, or render static screenshots server-side?
- **U3.** Should the generator emit `/styles/` variations (light/dark) or just one canonical style? (Twenty Twenty-Five ships multiple.)
- **U4.** Free-tier target vs paywall: do we enable BYO-API-key or ship with a keyed backend?
- **U5.** How many patterns per theme — 15 (MVP floor) or 25 (ambitious)? Tradeoff: generation cost + latency vs theme richness.
- **U6.** Style-profile commit step: separate LLM call before markup, or embed in planner output?

---

## 9. Key sources (referenced throughout)

- **WP Block Theme docs:** developer.wordpress.org/themes, schemas.wp.org/trunk/theme.json
- **Block markup parser:** `@wordpress/block-serialization-default-parser` (npm)
- **Playground:** playground.wordpress.net, wordpress.github.io/wordpress-playground
- **Twenty Twenty-Five source:** github.com/WordPress/twentytwentyfive
- **Anthropic docs:** Structured Outputs, Prompt Caching, Pricing
- **Prior art negative case:** Bossenger (jonathanbossenger.com, Apr 2026) — 9 commits of wp:html cleanup
- **Methodology:** Tasselli (DEV.to) — JSON IR beats direct markup
- **Competitor (closest):** Telex (telex.automattic.ai) — experimental, same problem space

---

**End of research brief.** All architecture decisions in Loop 2 must reference findings F1–F7. All failure modes in Loop 3 must have a mitigation mapped to this brief.
