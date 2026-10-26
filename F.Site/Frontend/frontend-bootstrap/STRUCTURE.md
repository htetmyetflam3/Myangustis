# `frontend-bootstrap/index.html` — wrapper map & conventions

A map of the page so you can edit markup without counting `</div>`s, plus the
two rules the refactor follows.

---

## 1. The naming rule

| suffix  | means                                                              | example |
| ------- | ------------------------------------------------------------------ | ------- |
| `*-bar` | **horizontal** wrapper — a row of children, flex row / `hstack`      | `ak-nav-bar`, `lp-chrome-bar`, `lp-callout-bar` |
| `*-box` | **square** wrapper — equal width & height (or a fixed aspect canvas) | `ak-burger-box` (2.5rem), `lp-callout-box` (2rem), `lp-screen-box` (1200×820) |
| `*-col` | a **column cell** of a grid/two-column split                        | `lp-art-col`, `lp-copy-col` |
| `*-stack` | a **vertical** wrapper — flex column / `vstack`                   | `ak-drawer-stack` |

Nothing else changes meaning: `is-*` is still state/variant, `ak-*` is the
page shell, `lp-*` is the hero slider, `ts-/pd-/up-/gr-` are the overlays.

## 2. The layout rule — Bootstrap, not a copy of the CSS

`scss/main.scss` compiles Bootstrap's **grid + utility API on Tailwind's own
scale**: the same breakpoints (sm 640 / md 768 / lg 1024 / xl 1280) *and* the
same spacing ramp, so a Tailwind class in `frontend-react/` has a 1:1
Bootstrap twin here instead of being re-typed as a hand-written rule.

| React (Tailwind)                 | Bootstrap mirror (this app)                     |
| -------------------------------- | ----------------------------------------------- |
| `fixed inset-x-0 top-0 z-50`     | `position-fixed top-0 start-0 end-0 z-50`        |
| `mx-auto max-w-[1440px]`         | `mx-auto mw-rail`                                |
| `max-w-7xl mx-auto px-4 sm:px-6` | `mw-7xl mx-auto px-4 px-sm-6`                    |
| `flex items-center gap-6`        | `hstack gap-6`                                   |
| `flex flex-col gap-1`            | `vstack gap-1`                                   |
| `ml-auto lg:ml-0`                | `ms-auto ms-lg-0`                                |
| `hidden lg:flex`                 | `d-none d-lg-flex`                               |
| `hidden sm:inline-flex`          | `d-none d-sm-inline-flex`                        |
| `px-5 py-3.5 sm:px-8 lg:px-12`   | `px-5 py-3-5 px-sm-8 px-lg-12`                   |
| `pt-20 lg:pt-24`                 | `pt-20 pt-lg-24`                                 |
| `grid gap-8 lg:gap-12`           | `d-grid gap-8 gap-lg-12`                         |
| `h-10 w-10 rounded-full`         | `size-10 rounded-circle`                         |
| `min-w-0` / `min-h-0`            | `min-w-0` / `min-h-0`                            |

Four utilities Bootstrap does not ship are generated in `main.scss`:
`min-w-*`, `min-h-*`, `size-*` (square w+h) and extra `mw-*` rails. The `-5`
in a class name is Tailwind's `.5` step (`py-3-5` === Tailwind `py-3.5`), because
a dot cannot appear unescaped in a class name.

**What stays in SCSS:** only what Bootstrap genuinely has no utility for —
colour, gradient, shadow, type, the hero's `minmax(0,1.02fr) minmax(0,1.08fr)`
split, the `1200/820` artwork canvas, the drawer's `0fr → 1fr` reveal, and odd
one-off values (`0.55rem 0.85rem`, `top: 42%`).

---

## 3. Converted already — header + hero

### Header (`index.html:91`)

```
header.ak-nav                      position-fixed top-0 start-0 end-0 z-50   ← scroll state only in SCSS
└ div.ak-nav-bar                   hstack gap-6 mw-rail mx-auto px-5 px-sm-8 px-lg-12 py-3-5
  ├ a.ak-brand                     d-flex align-items-center gap-3 text-decoration-none
  │ ├ svg.ak-brand-box             size-9                      → <use href="#i-mark">
  │ └ span.lh-1 › .ak-brand-name / .ak-brand-tag
  ├ nav.ak-nav-links-bar           ms-auto d-none d-lg-flex align-items-center gap-8
  └ div.ak-nav-actions-bar         d-flex align-items-center gap-3 ms-auto ms-lg-0
    ├ button.btn.btn-primary.btn-sm  d-none d-sm-inline-flex
    └ button.ak-burger-box         d-inline-flex d-lg-none … size-10 rounded-circle
└ div.ak-drawer                    glass d-grid d-lg-none overflow-hidden   ← 0fr→1fr in SCSS
  └ div.ak-drawer-stack            vstack gap-1 px-5 py-4 min-h-0
```

### Hero (`index.html:152`)

```
section#hero
└ div#heroSlider                   position-relative overflow-hidden w-100 mw-7xl mx-auto px-4 px-sm-6 pt-20 pt-lg-24
  ├ div.lp-kicker-bar              d-none d-lg-flex align-items-end justify-content-between mb-5
  └ div(position-relative)
    └ div.lp-stage                 position-relative overflow-hidden
      ├ button.lp-arrow-box ×2     position-absolute z-5 … size-10 rounded-circle   (top:42% in SCSS)
      ├ div.lp-track#heroTrack     d-flex                                   (transform in JS)
      │ └ div.lp-slide ×2          w-100 flex-shrink-0 min-w-0 d-grid align-items-center
      │   │                        gap-8 gap-lg-12 px-11 py-6 px-lg-15 pt-lg-10 pb-lg-12
      │   ├ div.lp-art-col         position-relative w-100 min-w-0
      │   │ ├ div.lp-frame         w-100
      │   │ │ ├ div.lp-chrome-bar  hstack justify-content-between gap-3
      │   │ │ │ └ div.lp-dots-bar  d-flex align-items-center min-w-0
      │   │ │ └ div.lp-screen-box  position-relative overflow-hidden        (1200/820 in SCSS)
      │   │ │   ├ svg.svg-fx       ← stays inline, see §5
      │   │ │   └ div.lp-callout-bar      position-absolute bottom-0 start-0 end-0 z-2 d-flex … flex-wrap gap-3
      │   │ │     └ div.lp-callout-left-bar  d-flex align-items-center min-w-0
      │   │ │       └ div.lp-callout-box     size-8 rounded-3 (2rem square)
      │   │ └ div.lp-float-bar     position-absolute z-3 d-none d-lg-inline-flex align-items-center gap-2 rounded-pill
      │   └ div.lp-copy-col        min-w-0 text-start pt-1 pb-2
      │     ├ div.lp-chip          d-inline-flex align-items-center gap-2 py-1 px-3 mb-4 rounded-pill
      │     ├ div.lp-checks        vstack gap-2 mb-8  › div.lp-check  d-flex align-items-center gap-2
      │     └ div.lp-actions-bar   d-flex align-items-center flex-wrap gap-3
      └ div.lp-pager-bar           d-flex justify-content-center gap-2 mt-2 mb-10   (lg: docks bottom-right, SCSS)
```

Renames to know about: `lp-hero/lp-wrap/lp-desktop/lp-art` are **gone** (pure
utilities now); `lp-chrome → lp-chrome-bar`, `lp-dots → lp-dots-bar`,
`lp-screen → lp-screen-box`, `lp-callout-ico → lp-callout-box`,
`ak-nav-inner → ak-nav-bar`, `ak-burger → ak-burger-box`,
`ak-drawer-inner → ak-drawer-stack`, `ak-nav-links → ak-nav-links-bar`.

---

## 4. Not converted yet — the rest of the page

Same rule applied as an inventory, so the next pass is mechanical. Horizontal
rows (`-bar` candidates) and squares (`-box` candidates), by section:

| section (line) | `-bar` candidates | `-box` candidates |
| --- | --- | --- |
| social proof (324) | `.ak-marquee-row`, `.ak-marquee-item` | `.ak-marquee-dot` 0.375 |
| how / compare (360, 410) | `.ak-label`, `.ak-bm-kicker`, `.ak-bm-tool-row`, `.ak-bm-chips` | `.ak-mk-ico` 1.5, `.ak-bm-step-n` 2 |
| voices / faq (593, 664) | `.ak-quote-head`, `.ak-quote figcaption`, `.ak-faq-q` | `.ak-faq-ico` 1.75 |
| cta / footer (684, 709) | `.ak-cta-actions`, `.ak-foot-brand`, `.ak-foot-bar-inner` | `.ak-foot-brand svg` 2.5 |
| sticky (758) | `.ak-sticky-bar` ✔ already named | `.ak-sticky-dot` 0.5, `.ak-sticky-x` 2 |
| overlay shell | `.ts-chrome`, `.ts-dots`, `.ts-badges` | `.ts-x` 2, `.ts-ico` 3, `.ts-dots i` 0.75 |
| pdf overlay (775) | `.pd-fixture-t`, `.pd-fixture-actions`, `.pd-pane-head`, `.pd-pane-head-l`, `.pd-pane-foot`, `.pd-repro-actions` | `.pd-loading-ico` 4 |
| upload overlay (927) | `.up-card-top`, `.up-name`, `.up-notice`, `.up-quota`, `.up-prompt-body`, `.up-prompt-btns`, `.up-sending`, `.up-actions`, `.up-delivery`, `.up-sent-t` | `.up-drop-ico` 3.5 |
| grammar overlay (1067) | `.gr-bar`, `.gr-bar-l`, `.gr-bar-r`, `.gr-tools`, `.gr-tools-l`, `.gr-tools-r`, `.gr-upload`, `.gr-tool-btn`, `.gr-issue-top`, `.gr-issue-diff`, `.gr-tip`, `.gr-toast` | `.gr-empty-ico` 3 |

---

## 5. The SVG sprite (`index.html:32`, first child of `<body>`)

Every icon is declared **once** as a `<symbol>` and used as:

```html
<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><use href="#i-download"></use></svg>
```

62 inline icons collapsed to 22 symbols; 6 more symbols serve the icons the
scripts render (`js/main.js`, `js/grammar-tool.js` now emit `<use>` too).
Only `viewBox` lives on the symbol — `stroke`, `stroke-width`, `fill`, size and
`class` stay at each use site, which is how one `#i-arrow-up-right` renders at
`stroke-width 2.4` in the nav and `1.6` in the benefits grid.

Symbols: `i-mark i-arrow-up-right i-menu i-x i-download i-download-box i-upload
i-close i-scan-frame i-scan-text i-scan-lines i-file i-file-check i-file-up
i-external-link i-refresh i-info-circle i-circle-check i-circle-slash
i-alert-triangle i-book-open i-copy i-wand i-check i-minus i-plus i-layers
i-keyboard`.

**The two hero illustrations stay inline on purpose.** Their animation classes
(`.fx-float`, `.fx-dash`, `.fx-spin`, `.svg-fx *`) are matched by document CSS,
and document CSS cannot reach inside a `<use>` shadow tree — spriting them would
silently freeze the hero artwork.
