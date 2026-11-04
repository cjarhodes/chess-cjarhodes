# Design spec: D · Blend (Paper + Club)

Phase 1 of [the redesign plan](redesign-plan.md). This document and its
three companion files are the source of truth for the new look:

| File | What it is |
|---|---|
| [`../styles/tokens.css`](../styles/tokens.css) | Every token: primitives, light/dark semantics, board themes. Loaded by the app (Phase 3), the gallery and the prototype |
| [`../styles/components.css`](../styles/components.css) | Every component, reading tokens only. Used by the gallery now; the app adopts its `c-*` classes in Phase 6 |
| [`design-system/index.html`](design-system/index.html) | Living gallery: every token and component, a theme and board switcher, and a live contrast table |
| [`design-directions/index.html`](design-directions/index.html) | Full-screen mockups at phone, tablet and desktop. Its D · Blend imports the real `styles/tokens.css` |
| [`../styles/fonts.css`](../styles/fonts.css), [`../fonts/`](../fonts/) | Self-hosted woff2 fonts (208 KB) with their OFL licences |
| [`../scripts/check-contrast.js`](../scripts/check-contrast.js) | Fails if any colour pair drops below WCAG AA, or if the two dark-theme copies drift apart |

To view: serve the repo (`python3 -m http.server 4173`) and open
`/docs/design-system/` and `/docs/design-directions/`. Both use the
self-hosted fonts, so they render correctly on the deployed site too.

Screenshots: `design-system/gallery-light.png`, `gallery-dark.png`, and
the `blend-*` and `phone-blend-*` mockups in `design-directions/`.

---

## 1. Decisions taken in Phase 1

| Question (from §6 of the plan) | Decision |
|---|---|
| Two serifs? | **Keep both, with a strict split.** Fraunces is used only at `--text-xl` and above (titles, big numbers). Newsreader is used for every coach sentence, prompt and explanation. The gallery's "Serif test" sets a long explanation in both: Fraunces' soft, wedge-shaped details are charming in a headline but busy over three or four lines, while Newsreader stays quiet. |
| Brass on cream contrast | Brass `--accent` is only ever a fill, with `--accent-ink` text on top (8.5:1). Brass as text or icon uses `--accent-text` (`#8f620c`, 5.2:1 on surface). Verified by `check-contrast.js`. |
| Move-quality colours as text | They fail AA as small text (inaccuracy 3.8:1, mistake 4.2:1 on surface). **Chip words stay in `--text`**, and only the tint and the symbol (`?!`, `?`, `??` …) carry the colour, which needs just 3:1 as a graphic. Every quality colour also travels with its symbol, so colour blindness doesn't hide the meaning. |
| Threat arrow colour | It was brass in the earlier blend, which made it hard to tell apart from hint arrows (identical in dark mode). **Threats are now blue-violet** (`--iris-500` / `--iris-300`). It's the only cool hue on the board, so a threat never reads as advice. |
| Board themes | **Sage** (default), **Walnut** (close to the old board), **Slate**, and **High contrast** (squares ≥ 3:1 apart, for low vision and bright rooms). Switch with `<html data-board-theme="green|walnut|blue|contrast">`; the keys match the values already saved under `ui:board-theme`, and the retired Ivory theme falls back to Walnut. |
| Piece sets | **cburnett only** for now. It's already vendored with its CC BY-SA 3.0 attribution. A second set waits until the board library (Phase 5) makes swapping trivial. |
| Light / dark | Follows `prefers-color-scheme`, overridden by `<html data-theme="light|dark">` from Settings. |

---

## 2. Foundations

### Colour

Three tiers, as in `tokens.css`. Components use only semantic and component
tokens.

| Semantic token | Light | Dark | Used for |
|---|---|---|---|
| `--bg` | `#f5efe3` | `#121714` | Page |
| `--surface` | `#fffcf6` | `#1b221e` | Cards, panels |
| `--surface-2` | `#f1e8d6` | `#242d28` | Inset cards (explanation), inputs, tracks |
| `--line` | `#e3d9c5` | `#2e3933` | Hairlines, card borders |
| `--text` | `#1f1b15` | `#f2ece0` | Primary text |
| `--text-2` | `#5c5446` | `#c2c4b6` | Secondary text |
| `--text-3` | `#6e6452` | `#8d9587` | Labels, captions (≥ 4.5:1 on every surface) |
| `--accent` | `#e9ac3f` | `#f0b84a` | Fills: primary button, current move, progress |
| `--accent-ink` | `#261a05` | `#1f1607` | Text on accent |
| `--accent-text` | `#8f620c` | `#f0b84a` | Accent as text or icon |
| `--accent-soft` | brass 18% | brass 15% | Selected rows, hover, highlights |
| `--danger` / `--success` | `#c2412d` / `#2f7d4c` | `#ff6a5a` / `#8fdc6a` | Errors, confirmations |

Component colours (in `tokens.css`): move quality `--mq-*`, arrows
`--arrow-best | played | threat | hint`, board squares and marks
`--board-*`, evaluation `--eval-*`, charts `--chart-*`.

### Type

| Token | Size | Family | Use |
|---|---|---|---|
| `--text-2xl` | 32px | Fraunces 600 | Panel title on desktop |
| `--text-xl` | 24px | Fraunces 600 | Panel title on phone; big numbers (accuracy) |
| `--text-lg` | 20px | DM Sans 600 | Card titles, app bar |
| `--text-prose` | 18px | Newsreader 400 | Every coach sentence, prompt, explanation (max 62ch) |
| `--text-md` | 16px | DM Sans | Body UI, buttons |
| `--text-sm` | 14px | DM Sans / DM Mono | Secondary UI; notation |
| `--text-xs` | 12px | DM Sans 600 | Labels, captions, board coordinates |

Labels are sentence case. The old all-caps tracked labels go, except where
an abbreviation is natural (ECO codes).

### Space, shape, depth, motion

- **Space:** 4, 8, 12, 16, 24, 32, 48, 64px (`--space-1` … `--space-8`).
- **Radius:** 8 (`--radius-sm`: inputs, squares of UI), 12 (`--radius-md`:
  buttons, segmented controls), 18 (`--radius-lg`: cards, dialogs), pill.
- **Elevation:** `--shadow-1` for floating cards and the active nav item;
  `--shadow-2` for dialogs and sheets. In light mode cards also get a
  hairline border; dark mode drops it.
- **Motion:** 120 / 200 / 320ms with `--ease-out`. All durations drop to 0
  under `prefers-reduced-motion`, including piece animation.

### Layout

| Width | Nav | Panel | Board |
|---|---|---|---|
| ≥ 1200px | Labelled rail, 84px | 400px floating cards | Fills the remaining height |
| 760–1199px | Icon rail, 64px | 340px | Same |
| < 760px | Bottom tab bar, 60px + safe area; app bar 48px | Flows below the board | Full width, no frame |

Breakpoints are 760px and 1200px. They can't be custom properties inside
media queries, so they live as constants in `components.css` and here.

---

## 3. Components

All in `components.css`, prefixed `c-`. State comes from ARIA and data
attributes (`aria-current`, `aria-selected`, `aria-pressed`,
`aria-expanded`, `data-mq`, `data-tone`, `data-state`), so script and style
agree on one source of truth.

| Component | Rules |
|---|---|
| `c-btn` | Variants `--primary`, default (secondary), `--quiet`, `--danger`, `--icon`, `--block`. **Exactly one `--primary` visible per screen state** (today's `data-primary-action` check in `verify-ui-journeys.js` carries over). Minimum 40px tall, 44px for icons, 48px for block buttons on phone. |
| `c-chip` | Plain, or `data-mq="…"` for move quality. The word stays in body colour; the symbol and tint carry the quality colour. |
| `c-glyph` | 24px quality badge on the destination square, offset to the top-right corner. |
| `c-card`, `c-card--inset` | Floating cards make up the context panel. Inset cards hold the moment explanation and drill prompt. |
| `c-tabs`, `c-segmented` | Tabs switch views inside a panel; segmented controls pick an option (play as, theme). |
| `c-notation`, `c-notation-strip` | Three-column table on tablet and desktop; a horizontally scrolling strip on phone, kept centred on the current move. The current move is an accent fill; the quality symbol follows the move. |
| `c-hint` | The hint ladder: idea → piece → square → answer. Closed rungs are dashed; opened ones solid. |
| `c-status` | The line above the board: accent-text label + one plain sentence ("Your turn · White", "Play on the board or type a move."). |
| `c-banner` | Inline notices with `data-tone="warning|danger"` (offline, sync failed, storage fallback). |
| `c-disclosure` | `<details>` for secondary depth (engine details). Never for primary flows. |
| `c-strip` | Player strip: avatar, name, meta, captured pieces and material lead. |
| `c-evalbar` | `--eval` sets White's share. Vertical beside the board on tablet and desktop; `--horizontal` (6px) above the board on phone. Hidden during drills. |
| `c-nav`, `c-badge`, `c-appbar` | Four destinations plus Settings. On phone the nav becomes the tab bar and Settings moves to the app-bar gear. The badge shows the due count on Train. |
| `c-dialog`, `c-sheet` | Native `<dialog>` with focus trap and scrim. Settings is a right-hand sheet on desktop and full screen on phone. |
| `c-field`, `c-input`, `c-check`, `c-range` | 44px controls; `--mono` input for move entry. |
| `c-progress`, `c-segments`, `c-stat`, `c-statlist` | Progress bar; per-item session segments (`data-state="done|missed|current"`); big-number stats; key/value lists. |
| `c-empty` | One sentence of what happened, one of what to do, and one primary button. |
| `c-prose`, `c-ref` | Coach text. A `c-ref` phrase draws its arrow or square on the board when hovered (desktop) or tapped (touch). |

---

## 4. The board's visual language

| Mark | Token | When |
|---|---|---|
| Last-move tint | `--board-last` | Always |
| Selected piece | `--board-select` | While choosing a move |
| Legal-move dots | `--board-dot` | While a piece is selected |
| Check glow | `--board-check` | King in check |
| Best-move arrow | `--arrow-best` | Review, Show line, Explorer top move |
| Played-move arrow | `--arrow-played` | Review of a mistake (alongside best) |
| Threat arrow | `--arrow-threat` | Review and live play when Coach flags a threat. Never during drills |
| Hint arrow | `--arrow-hint` | Drills, only after the "square" hint is opened |
| Quality badge | `c-glyph` | Review: destination square of the reviewed move |

During **drills**, the eval bar, quality badges and best/threat arrows are
all hidden, so nothing gives the answer away. The hint arrow appears only
when asked for.

---

## 5. Accessibility rules

- Text ≥ 4.5:1 and graphics ≥ 3:1 in both themes; `node scripts/check-contrast.js`
  enforces 54 pairs.
- Never colour alone: move quality always shows its symbol or word, and
  arrows have a legend and an equivalent text line in the panel.
- Focus ring: 2px `--focus-ring`, offset 2px, on every interactive element.
- Touch targets ≥ 44px; primary actions on phone are full width and 48px tall.
- Respect `prefers-reduced-motion` and `prefers-color-scheme`.
- Live regions stay as today: status line and quiz/drill feedback announce
  changes (checklist §2).

## 6. Voice

Plain, specific, kind. Say what happened and what to do, in that order.

| Instead of | Write |
|---|---|
| Train Opening principle gaps, then transfer | Practise two of your recent opening mistakes, then play a short game |
| Adaptive session · 5–10 min | Today's training · about 10 minutes |
| Inaccuracy (−0.8) | Inaccuracy: this gives back most of your edge |
| Never attempted | Not practised yet |

---

## 7. Fonts to vendor (Phase 3)

All four families are under the SIL Open Font License 1.1. Ship them as
woff2 in `/fonts/` with an `OFL.txt` alongside, use `font-display: swap`,
and preload only the two used above the fold (DM Sans 400 and Fraunces 600).

| Family | Weights / styles | Notes |
|---|---|---|
| Fraunces | 600 | Static instance at display optical size; titles only |
| Newsreader | 400, 400 italic, 500 | Text optical size |
| DM Sans | 400, 500, 600, 700 | Or the variable font if it is smaller |
| DM Mono | 400, 500 | Notation, FEN, numbers |

Subset to Latin + Latin-1 + the chess and typographic symbols used
(… · ★ ✓ ⇅ ← →). Budget: about 250 KB of woff2 in total. Measure when
vendoring and drop a weight if it goes over.

## 8. Handoff to Phase 3

**Done (Phase 3).** What actually happened, for the record:

- `styles/fonts.css` and `styles/tokens.css` load before `styles.css`;
  `styles/components.css` is not linked yet (Phase 6 adopts its classes).
- Every raw colour, font size, font family and radius in `styles.css` maps
  to a token; the all-caps tracked labels became sentence case.
- In the height-constrained board columns, the coach line and controls use
  the compact steps (`--text-md` and `--text-xs`). The coach line and the
  controls row also keep a readable width independent of the board: tying
  them to the board width made wrapped text shrink the board further, which
  had left the 1280×800 opening-return state at exactly the 320px minimum
  before the reskin.
- Settings gained Appearance (Match device / Light / Dark); board themes
  are Sage (default), Walnut, Slate and High contrast.

The original handoff plan:

1. Copy `tokens.css` and `components.css` into `styles/`. Add
   `@layer reset, tokens, base, components, layout, views, utilities;` at
   the top of `styles.css` and wrap the existing rules in `@layer views`, so
   the new layers take effect without a big-bang rewrite.
2. Map today's tokens onto the new ones, then replace raw colours and sizes
   rule by rule. **Watch the false friend:** today's `--accent-soft` is a
   text colour, while the new `--accent-soft` is a translucent highlight.

   | Today (`styles.css`) | Uses | New |
   |---|---|---|
   | `--bg`, `--surface`, `--text` | 8, 33, 86 | same names |
   | `--surface2` | 21 | `--surface-2` |
   | `--muted` | 110 | `--text-3` (labels) or `--text-2` (sentences); choose per rule |
   | `--border`, `--rule-1`, `--rule-3` | 68, 2, 11 | `--line` |
   | `--accent` (claret) | 41 | `--accent` (brass) for fills; check every text use, which may need `--accent-text` |
   | `--accent-dim` | 6 | `--accent-soft` |
   | `--accent-soft` (claret-300 text) | 46 | `--accent-text` |
   | `--success`, `--success-bg` | 4, 2 | `--success`; tint via `color-mix()` |
   | `--error`, `--error-bg` | 0, 1 | `--danger` |
   | `--highlight` (brass) | 16 | `--board-last` on the board; `--accent-text` elsewhere |
   | `--white-cat`, `--black-cat`, `--walnut` | 2, 0, 3 | `--board-light`, `--board-dark`, `--board-frame` |
   | `--font-mono`, `--font-reading` | many | `--family-mono` / `--family-ui` (most UI moves off mono), `--family-prose` |
   | `--rail-left`, `--rail-right` | layout | stay until Phase 6, then `--nav-w`, `--panel-w` |

3. Add a lint step (a small node script, like the validators) that fails on
   hex colours, `font-size` values or `font-family` names outside
   `styles/tokens.css`, and run `check-contrast.js` with the validators.
4. Re-run `scripts/capture-baseline.sh` and compare against the Phase 0
   baseline: same layout, new skin.
