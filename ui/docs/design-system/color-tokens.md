# Color Tokens

All tokens are defined in `ui/src/styles/base.css` under `:root` (dark mode default) and `:root[data-theme-mode="light"]` (light override). Values in this doc are the default claw family; the knot (`data-theme="openknot"`/`openknot-light`) and dash (`dash`/`dash-light`) families override surface, accent, and status tokens in their own `base.css` blocks, each with its own WCAG audit comment.

> Contrast ratios are measured against `--bg` (`#0e1015`) in dark mode using WCAG relative luminance formula. AA requires ≥4.5:1 for normal text, ≥3:1 for large text and UI components.

---

## Background Scale

| Token           | Dark Value | Light Value | Use                           | Don't                          |
| --------------- | ---------- | ----------- | ----------------------------- | ------------------------------ |
| `--bg`          | `#0e1015`  | `#faf9f7`   | Page root, deepest layer      | Never use on elevated surfaces |
| `--bg-accent`   | `#13151b`  | `#f4f1ec`   | Sidebar, secondary panels     | Not for interactive card hover |
| `--bg-elevated` | `#191c24`  | `#ffffff`   | Raised panels, modals         | Not for inline elements        |
| `--bg-hover`    | `#1f2330`  | `#efebe4`   | List item hover state         | Not for default state          |
| `--bg-muted`    | `#1f2330`  | `#efebe4`   | Subtle fills, disabled states | Not for focus states           |

Light mode uses a warm paper palette: ivory backgrounds, warm gray borders (`#e8e4dc`), and a deep Cupcake pink accent (`#c2185b`, ≈5.6:1 on `--bg`). Dark mode uses the Cupcake pink scale below.

## Surface / Card

| Token                  | Dark Value               | Light Value           | Use                           | Don't           |
| ---------------------- | ------------------------ | --------------------- | ----------------------------- | --------------- |
| `--card`               | `#161920`                | `#ffffff`             | Card backgrounds, composer    | Avoid as border |
| `--card-foreground`    | `#f0f0f2`                | `#211e1a`             | Text on cards                 | —               |
| `--card-highlight`     | `rgba(255,255,255,0.04)` | `rgba(60,42,24,0.03)` | Inner highlight on hover      | Not for text    |
| `--popover`            | `#191c24`                | `#ffffff`             | Dropdown, tooltip backgrounds | —               |
| `--popover-foreground` | `#f0f0f2`                | `#211e1a`             | Text inside popovers          | —               |

## Text

| Token            | Dark Value | Contrast on `--bg` | Use                                                |
| ---------------- | ---------- | ------------------ | -------------------------------------------------- |
| `--text`         | `#bcbcc0`  | ~10.1:1 ✅         | Body copy, labels                                  |
| `--text-strong`  | `#f4f4f5`  | ~17.3:1 ✅         | Headings, emphasis                                 |
| `--muted`        | `#8b8b94`  | ~5.6:1 ✅          | Placeholder, metadata                              |
| `--muted-strong` | `#898990`  | ~5.5:1 ✅          | Secondary text, captions; prefer `--text` for body |

## Cupcake Pink Scale (primitives)

Defined once in `:root` for reference and docs; the live accent tokens repeat the literal hex (MCP app guest documents and the contrast tests read literals, not `var()`).

| Token                     | Value     | Role                                                     | Contrast on `--bg` |
| ------------------------- | --------- | -------------------------------------------------------- | ------------------ |
| `--cupcake-pink-calm`     | `#ff8fab` | Soft rose: calm hover / lifted accent                    | 8.85:1 ✅          |
| `--cupcake-pink`          | `#ff6b9d` | Primary pink: default (calm) accent                      | 7.11:1 ✅          |
| `--cupcake-pink-hot`      | `#ff2d6f` | Hot magenta: hot ring, glow, and tint source             | 5.31:1 (see note)  |
| `--cupcake-pink-hot-text` | `#ff3d7a` | Hot accent as text (magenta lifted for AA on hover rows) | 5.62:1 ✅          |
| `--cupcake-pink-deep`     | `#d81b60` | Calm filled button (white ink 4.95:1)                    | —                  |
| `--cupcake-pink-deeper`   | `#c2185b` | Calm button hover / hot fill / light accent (5.87:1)     | —                  |
| `--cupcake-pink-deepest`  | `#ad1457` | Hot button hover / hot light accent (6.97:1)             | —                  |

> Raw `#ff2d6f` is 4.91:1 on `--card` but only 4.37:1 on `--bg-hover`, so it is never used as text; hot mode uses `#ff3d7a` (4.62:1 on `--bg-hover`) for `--accent`.

## Accent (Primary — Cupcake Pink)

The claw family ships two intensities, selected by `data-accent-heat` on `<html>` (`calm` default, `hot`). The attribute is browser-local: `app/accent-heat.ts` stores it in `localStorage` (`openclaw.control.accentHeat.v1`), `index.html` applies it before first paint, and `bootstrap-theme.ts` reapplies it on every theme presentation pass. Toggle it in **Settings → Appearance → Accent color → Pink intensity**. Named palettes (knot, dash, rose, …) keep their own accents, and an explicit profile/gateway accent override still wins over both.

| Token             | Calm (dark)             | Hot (dark)              | Calm (light)           | Hot (light)            | Use                                            |
| ----------------- | ----------------------- | ----------------------- | ---------------------- | ---------------------- | ---------------------------------------------- |
| `--accent`        | `#ff6b9d`               | `#ff3d7a`               | `#c2185b`              | `#ad1457`              | Primary CTA, send button, active tab indicator |
| `--accent-hover`  | `#ff8fab`               | `#ff6b9d`               | `#ad1457`              | `#8e0e44`              | Hover state of accent elements                 |
| `--accent-muted`  | `#ff6b9d`               | `#ff3d7a`               | `#c2185b`              | `#ad1457`              | Same as accent (aliased)                       |
| `--accent-subtle` | `rgba(255,107,157,0.1)` | `rgba(255,45,111,0.14)` | `rgba(194,24,91,0.08)` | `rgba(173,20,87,0.1)`  | Badge backgrounds, tinted fills — not text     |
| `--accent-glow`   | `rgba(255,107,157,0.2)` | `rgba(255,45,111,0.32)` | `rgba(194,24,91,0.12)` | `rgba(173,20,87,0.18)` | Focus rings, glow effects — not background     |
| `--ring`          | `#ff6b9d`               | `#ff2d6f`               | `#c2185b`              | `#ad1457`              | Focus ring colour                              |
| `--primary`       | `#d81b60`               | `#c2185b`               | `#c2185b`              | `#ad1457`              | Filled primary buttons (white text)            |
| `--primary-hover` | `#c2185b`               | `#ad1457`               | = `--accent-hover`     | `#8e0e44`              | Filled primary hover                           |

### WCAG 2.1 AA audit (computed with the WCAG relative-luminance formula; locked by `ui/src/styles/cupcake-pink-contrast.node.test.ts`)

| Pair                                         | Calm dark | Hot dark | Calm light | Hot light |
| -------------------------------------------- | --------- | -------- | ---------- | --------- |
| `--accent` text on `--bg`                    | 7.11      | 5.62     | 5.58       | 6.62      |
| `--accent` text on `--card`                  | 6.57      | 5.19     | 5.87       | 6.97      |
| `--accent` text on `--bg-hover`              | 5.85      | 4.62     | —          | —         |
| `--accent-hover` text on `--bg`              | 8.85      | 7.11     | 6.62       | 8.69      |
| `--accent-foreground` on `--accent`          | 7.11      | 5.62     | 5.87       | 6.97      |
| `--primary-foreground` `#fff` on `--primary` | 4.95      | 5.87     | 5.87       | 6.97      |
| `--primary-foreground` on `--primary-hover`  | 5.87      | 6.97     | 6.97       | 9.14      |
| `--ring` on `--bg` (UI indicator, ≥3:1)      | 7.11      | 5.31     | 5.58       | 6.62      |

The **Appearance → Accent color** "Claw red" preset (`#ff5c5c`) remains available as an explicit opt-in override.

For connections bound to an authenticated Gateway profile, the profile's `ui.accent` preference overrides the gateway-wide `ui.prefs.accent` setting, which overrides `ui.seamColor`, which overrides the active theme's default accent. Connections without an authenticated profile retain the existing gateway-wide precedence. Every override updates the accent, primary, and focus token families together; `--accent-foreground` and `--primary-foreground` automatically switch between dark and white ink according to the accent's relative luminance. Clearing a profile preference restores the gateway-wide accent, configured seam color, or theme defaults without changing anyone else's appearance.

## Accent 2 (Teal)

| Token               | Value                  | Use                                       |
| ------------------- | ---------------------- | ----------------------------------------- |
| `--accent-2`        | `#14b8a6`              | Success-adjacent status, secondary badges |
| `--accent-2-muted`  | `rgba(20,184,166,0.7)` | Subtle teal fills                         |
| `--accent-2-subtle` | `rgba(20,184,166,0.1)` | Tinted teal background                    |

## Semantic

| Token           | Dark Value | Light Value | Contrast on dark `--bg` | Use                                            |
| --------------- | ---------- | ----------- | ----------------------- | ---------------------------------------------- |
| `--ok`          | `#22c55e`  | `#166534`   | ~8.4:1 ✅               | Success states, token meter low                |
| `--warn`        | `#f59e0b`  | `#92400e`   | ~8.9:1 ✅               | Warnings, degraded states                      |
| `--danger`      | `#f87171`  | `#b91c1c`   | ~6.9:1 ✅               | Errors, destructive text, token meter high     |
| `--info`        | `#60a5fa`  | `#1d4ed8`   | ~7.5:1 ✅               | Informational, token meter mid                 |
| `--destructive` | `#d32f2f`  | `#dc2626`   | ~3.8:1 (fill only)      | Destructive button fills (with `#fafafa` text) |

Each `--x` has `-muted` (0.75 alpha) and `-subtle` (0.08 alpha) rgba siblings that must stay in sync with the base hex — the base doubles as label text on its own subtle tint, and re-tinting one without the other silently drops the pair below AA. Bases stay literal hex because `widget-theme.ts` publishes them to MCP app guest documents where `color-mix()` would not resolve. See the audit comments in `base.css` for the per-theme measurements.

The dark `--destructive` value is the claw-family override (`:root[data-theme="dark"]`); the shared `:root` fallback is `#ef4444`.

## Border

| Token             | Value     | Use                              |
| ----------------- | --------- | -------------------------------- |
| `--border`        | `#1e2028` | Default subtle borders, dividers |
| `--border-strong` | `#2e3040` | Active/focused borders           |
| `--border-hover`  | `#3e4050` | Hover-state borders              |

## Focus

| Token          | Value                                                                             | Use                            |
| -------------- | --------------------------------------------------------------------------------- | ------------------------------ |
| `--ring`       | `#ff6b9d` (calm) / `#ff2d6f` (hot)                                                | Focus ring colour              |
| `--focus-ring` | `0 0 0 2px var(--bg), 0 0 0 3px color-mix(in srgb, var(--ring) 80%, transparent)` | Standard focus ring box-shadow |
| `--focus-glow` | `0 0 0 2px var(--bg), 0 0 0 3px var(--ring), 0 0 16px var(--accent-glow)`         | Elevated interactive elements  |

---

## Anti-Patterns

- ❌ Hardcoded hex colours in component CSS — always use tokens
- ❌ `--accent-subtle` as text colour — fails contrast on dark backgrounds
- ❌ Mixing `--ok` and `--accent-2` for "green success" — use `--ok` only
- ❌ Using `--danger` for non-error states (e.g. "hot feature") — reserve for errors and destructive actions
- ❌ `--muted-strong` for normal body text — passes AA on `--bg` but not on every hover/input surface; use `--text` instead
