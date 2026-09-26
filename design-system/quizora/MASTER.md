# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/quizora/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file. If not, follow the rules below.
> The implemented tokens live in `css/main.css` — keep this file and that file in sync.

---

**Project:** Quizora
**Source:** UI/UX Pro Max skill (`search.py "online course e-learning academic assessment" --design-system --variance 4 --motion 3 --density 6`), then verified and adjusted as noted below.
**Category:** Online Course / E-learning (student side) + Education Dashboard (teacher side)
**Audience:** College students on phones right after class; teachers on laptops.
**Design Dials:** Variance 4/10 (balanced) · Motion 3/10 (subtle) · Density 6/10 (standard)

---

## Logo

| File (assets/brand/) | Use |
|------|-----|
| `quizora-logo.svg` | Wordmark only: navbar on every page (34px high) |
| `quizora-logo-tagline.svg` | Full logo with "Learn . Quiz . Progress": landing hero (320px wide, 260px on phones), sign-in / sign-up / reset cards (240px). Never narrower than 220px, or the tagline stops being legible |
| `quizora-mark.svg`, `/favicon.svg` | The Q on its own: browser tab |
| `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png` | Phone home-screen / installed-app icons (see `/manifest.webmanifest`) |
| `og-image.png` (1200×630) | Link previews when the site or a sign-up link is shared |

- The logo uses the site palette so brand and UI match: Q gradient `#14B8A6 → #0F766E` (teal-500 → `--primary`), wordmark `#134E4A` (`--text-primary`), sparkle `#EA580C` (`--accent`), tagline `#0F766E` (`--primary`). The original blue/purple artwork is in git history (commit 72fc5fe).
- Always place the logo on white or `--bg-primary`; never on the dark teal CTA band.
- The PNGs are rendered from the SVGs. Regenerate them if the logo changes.

## Style

**Minimalism** — clean, functional, white space, clear type hierarchy, borders over shadows,
solid fills (no gradients), subtle 150–250ms state transitions, one primary accent.

## Color Palette — "Progress teal + achievement orange"

| Role | Hex | Token | Notes |
|------|-----|-------|-------|
| Primary (buttons, links, focus) | `#0F766E` | `--primary` | 5.47:1 with white. Skill value `#0D9488` is only 3.74:1 with white, so it is used for graphics only (`--primary-bright`). |
| Primary hover | `#115E59` | `--primary-hover` | 7.58:1 with white |
| Primary soft / tint | `#F0FDFA` / `#CCFBF1` | `--primary-soft` / `--primary-tint` | selected & hover backgrounds |
| Accent (achievement) | `#EA580C` | `--accent` | graphics, borders, score ring. Never white text on it (3.56:1). |
| Accent text | `#C2410C` / `#9A3412` on `#FFF7ED` | `--accent-text` / `--accent-strong` | 5.18:1 / 6.88:1 |
| Page background | `#F0FDFA` | `--bg-primary` | |
| Card | `#FFFFFF` | `--bg-card` | |
| Heading / body text | `#134E4A` | `--text-primary` | 9.48:1 |
| Secondary text | `#475569` | `--text-secondary` | 7.58:1 |
| Muted text | `#5B6B79` | `--text-muted` | 5.49:1 |
| Decorative borders | `#D5E3E0` | `--border-color` | dividers and card edges only |
| Form-control borders | `#7B8C98` | `--border-input` | 3.47:1 non-text contrast (skill's `#5EEAD4` fails) |
| Success / Warning / Danger | `#15803D` / `#A16207` / `#B91C1C` | `--success` / `--warning` / `--danger` | each ≥ 4.7:1 on its tinted background |

## Typography

**Plus Jakarta Sans** (400–800) for headings and body — skill pairing "Friendly SaaS"
(web apps, dashboards, productivity). *Override:* the generated pairing (Baloo 2 + Comic Neue)
targets children's apps and was rejected for a college audience.

- Loaded with `preconnect` + `<link>` (no CSS `@import`), `display=swap`
- Body 16px / 1.6; inputs 16px (prevents iOS zoom)
- `font-variant-numeric: tabular-nums` for scores, stats, tables and the timer

## Spacing (density 6/10)

`--space-xs 4px · --space-sm 8px · --space-md 16px · --space-lg 24px · --space-xl 32px · --space-2xl 48px · --space-3xl 64px`

## Radius & Elevation

- Radius: 6px (small controls) · 8px (buttons, inputs) · 12px (cards) · 16px (modals, question card)
- Shadows: `--shadow-sm` on cards, `--shadow-md` on hover, `--shadow-lg` for floating bars, `--shadow-xl` for modals

## Components

- **Primary button:** solid `--primary`, white text, 8px radius, min-height 42px (44px on phones)
- **Secondary button:** white with `--border-hover`, turns `--primary-soft` on hover
- **Cards:** white, 1px `--border-color`, 12px radius, `--shadow-sm`
- **Inputs:** 1px `--border-input`, 44px min-height, focus = primary border + 4px `--primary-glow` ring; invalid = `--danger` border + inline `.field-error` linked by `aria-describedby`
- **Quiz options:** 56px min-height; selected = primary fill on the letter key **and** a check mark (not colour alone)
- **Score pills (gradebook):** number + colour band (≥80% green, 50–79% amber, <50% red); missed = dashed outline, open = dot, before joining = dash
- **Class chip:** pill with a graduation-cap icon, `--primary` text on `--primary-soft`, e.g. "BBA · 1st Semester"; large size in page headers
- **Class picker:** select of existing classes (with subject counts) plus "+ Add a new class", which reveals Program / Semester / Section fields indented behind a `--primary-border` rule
- **Subject rows (teacher sign-up):** repeatable inset panels on `--bg-glass`, numbered "Subject 1, 2…", with an icon remove button labelled "Remove subject N"

## Page Pattern (landing)

**Feature-Rich Showcase** — Hero (value proposition + product preview) → feature grid (6) →
How it works (teacher / student tracks) → closing CTA. CTA repeated in hero and at the bottom.
*Override:* the generated "Hero + Testimonials" pattern was rejected — there are no verified
testimonials, and fabricating social proof is not acceptable.

## Motion

Subtle only: page content fades in (250ms), state changes 150–250ms, modals ease in over 200ms and
out over 150ms. All animation and smooth scrolling is disabled under `prefers-reduced-motion`.
No GSAP — the site has no build step and the motion budget is low.

## Gamification (skill anti-pattern: "no gamification")

- Encouraging score message on the result screen (tiers at 90 / 70 / 50%)
- Achievement-orange score ring
- Participation progress bar on subject cards (green at 100%)

## Accessibility rules applied

- Skip link on every page; `<main id="main">` target
- `scroll-padding-top` so the sticky header never hides the focused element (WCAG 2.2 focus-not-obscured)
- Visible 2px focus ring on every interactive element
- Pointer targets ≥ 24px everywhere (WCAG 2.2 AA), ≥ 44px for primary controls on phones
- `touch-action: manipulation` on interactive elements
- Colour is never the only signal (icons, text, shapes accompany every status colour)

## Anti-Patterns (do not use)

- ❌ Emojis as icons — use inline SVG line icons (2px stroke)
- ❌ Gradients and glass effects (Minimalism)
- ❌ White text on `#0D9488` or `#EA580C`
- ❌ Placeholder-only labels; errors shown only at the top of a form
- ❌ Hover-only interactions
- ❌ Fabricated testimonials or social proof

## Pre-Delivery Checklist

- [ ] No emojis used as icons
- [ ] `cursor: pointer` on clickable elements
- [ ] Hover/press states with 150–300ms transitions
- [ ] Text contrast ≥ 4.5:1; control borders and meaningful icons ≥ 3:1
- [ ] Visible focus states; focus never hidden behind the sticky header
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive at 375, 768, 1024 and 1440px with no horizontal page scroll
