# MELO — Design system

Documented from the built landing page (`app/landing/page.tsx`) and app (`app/page.tsx`). Tokens live in `app/globals.css`.

## World
Light grey paper, heavy black grotesque type, and two brand colours with fixed meanings:
- **Lime = funds.** Primary actions, escrow, money in motion.
- **Teal = verified.** Verification, success, the "connected" state.

The mark is two interlocking isometric cubes: lime (escrow) and teal (payout). It appears as a static SVG (`components/landing/melo-mark.tsx`) and as a pointer-tilting CSS 3D object in the hero (`components/landing/cube-mark.tsx`).

## Colour tokens
| Token | Value | Use |
|---|---|---|
| `--ink` | `oklch(0.17 0.005 120)` | Text, dark surfaces (code panels), completed steps |
| `--paper` | `oklch(0.955 0.004 110)` | Page ground |
| `--lime` | `oklch(0.93 0.2 124)` | Primary buttons, active step, the Arc band, text selection |
| `--lime-strong` | `oklch(0.88 0.21 127)` | Lime hover, rail progress |
| `--teal` | `oklch(0.72 0.125 184)` | Verified states, status dots, focus ring |
| `--teal-ink` | `oklch(0.47 0.085 190)` | Teal text on light surfaces (meets 4.5:1) |

shadcn semantic tokens map onto these: `--primary` is lime with ink text, `--ring` is teal, `--accent` is a pale teal with `--teal-ink` text. White (`bg-white`) is used for raised sections and cards.

Text on lime is always ink. Never put white text on lime or teal.

## Type
- **Display:** Archivo (variable, `wdth` axis), weight 700–800, tracking `-0.025em` to `-0.035em`, leading `0.94–1.05`. Max 6rem (hero `clamp(3rem, 8.4vw, 6rem)`).
- **Body/UI:** Geist, 16–20px body, `text-ink/65–80` for secondary copy.
- **Mono:** Geist Mono, only for code, state identifiers, chain IDs, and addresses.
- Headings use `text-wrap: balance`; paragraphs use `pretty`.

## Components
- **Buttons:** pills, 44–48px tall. Primary: lime fill with ink text, `hover:bg-lime-strong`. Secondary: 1.5px inset ink ring that fills ink on hover. All get `active:scale-[0.96]` and transition only the specific properties that change.
- **Rules over cards:** sections are separated by hairline `ink/10` borders; lists (principles, Arc facts) are ruled rows, not card grids.
- **Code panel:** ink surface, lime strings, teal keys, soft layered shadow, tabs plus a copy button whose icon swaps with a blur/scale spring (bounce 0).
- **Settlement rail:** a five-step tablist with a progress track. The track fills lime, then turns teal once the flow reaches verification. It auto-advances until the user interacts, pauses on hover, and stays static when reduced motion is on.

## Motion
One authored moment per surface: the hero cube's pointer tilt and slow float, plus the rail's progression. Everything else is at most a 150ms colour or scale transition. All motion respects `prefers-reduced-motion`.

## Browser surfaces
Text selection is lime on ink. The caret and form accents are teal-ink. Focus rings are a 2px teal-ink outline with a 2px offset. Fonts are antialiased.

## Content rules
Claims come only from `PRODUCT.md`. Illustrative data is labelled ("Illustrative draft", "Sample data", "testnet"), and the status line "In development… not production-ready" stays visible in the hero and the footer.
