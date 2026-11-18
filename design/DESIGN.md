---
name: SEO Supervisor Report
description: A credit report for a website. One offline file, neutral, light and dark.
colors:
  ground: "#f4f6f9"
  panel: "#ffffff"
  ink: "#1c2a39"
  ink-secondary: "#3a4757"
  mute: "#5d6878"
  hairline: "#e2e6ec"
  hairline-strong: "#cfd6df"
  neutral-bar: "#8a95a5"
  working-blue: "#2459c9"
  working-blue-soft: "#e9effc"
  selection: "#cfe0ff"
  band-critical: "#d64040"
  band-poor: "#e9772e"
  band-fair: "#e3a21a"
  band-good: "#6fb35a"
  band-excellent: "#238a52"
  band-critical-ink: "#c03030"
  band-poor-ink: "#b5541a"
  band-excellent-ink: "#1d7444"
  sev-blocker: "#c93636"
  sev-high: "#e0702b"
  sev-decision: "#7b52c7"
  sev-medium: "#d99a12"
  sev-low: "#7d8a9c"
  passed: "#238a52"
  passed-soft: "#e6f4ec"
  decision-soft: "#f0eafb"
  warn-soft: "#fdf3dc"
  chip-ink-on-light-band: "#ffffff"
  chip-ink-fair: "#2b2000"
  chip-ink-good: "#0f2a12"
  dark-ground: "#0e131a"
  dark-panel: "#151c26"
  dark-ink: "#e6ebf2"
  dark-ink-secondary: "#c3ccd8"
  dark-mute: "#98a3b3"
  dark-hairline: "#232c39"
  dark-hairline-strong: "#323d4d"
  dark-neutral-bar: "#6b7788"
  dark-working-blue: "#7ea2ff"
  dark-working-blue-soft: "#1b2640"
  dark-selection: "#2a3d66"
  dark-band-critical: "#ef6464"
  dark-band-poor: "#f38b4a"
  dark-band-fair: "#efb93b"
  dark-band-good: "#86c873"
  dark-band-excellent: "#45b97a"
  dark-sev-decision: "#a587ec"
  dark-sev-low: "#8c99ab"
  dark-passed-soft: "#14291e"
  dark-warn-soft: "#2c2412"
  dark-decision-soft: "#231c38"
  dark-chip-ink: "#0e131a"
typography:
  display:
    fontFamily: "Bricolage Grotesque, Geist, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"
    fontSize: "clamp(80px, 10vw, 124px)"
    fontWeight: 700
    lineHeight: 0.86
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Bricolage Grotesque, Geist, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"
    fontSize: "clamp(26px, 3.4vw, 34px)"
    fontWeight: 700
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"
    fontSize: "15.5px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "\"tnum\""
  label:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
    letterSpacing: "0.02em"
  small:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
  control:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 500
  question:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"
    fontSize: "16.5px"
    fontWeight: 600
  figure:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1
rounded:
  marker: "2px"
  flag: "4px"
  code: "5px"
  row: "6px"
  control: "8px"
  panel: "10px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  row: "14px"
  gutter: "18px"
  panel-y: "22px"
  panel-x: "24px"
  section: "26px"
components:
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
    padding: "22px 24px"
  tab:
    textColor: "{colors.mute}"
    typography: "{typography.title}"
    padding: "10px 0 12px"
  tab-selected:
    textColor: "{colors.ink}"
  tab-count:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.mute}"
    rounded: "{rounded.pill}"
    padding: "0 7px"
  band-chip:
    backgroundColor: "{colors.band-poor-ink}"
    textColor: "{colors.panel}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  segment-button:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
  segment-button-pressed:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
  search-field:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 10px"
  finding-card:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
    padding: "14px 18px"
  finding-card-dimmed:
    backgroundColor: "{colors.ground}"
  status-pill:
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.pill}"
    padding: "2px 9px"
  fixed-stamp:
    textColor: "{colors.passed}"
    rounded: "{rounded.code}"
    padding: "2px 8px"
  fix-callout:
    backgroundColor: "{colors.working-blue-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px 14px"
  decision-callout:
    backgroundColor: "{colors.decision-soft}"
    rounded: "{rounded.control}"
    padding: "12px 14px"
  done-callout:
    backgroundColor: "{colors.passed-soft}"
    rounded: "{rounded.control}"
    padding: "12px 14px"
---

# Design System: SEO Supervisor Report

## Overview

**Creative North Star: "The Credit Report"**

The report reads like plain form stock: a cool grey ground, white panels drawn with 1px hairlines, one ink, one working blue. A single 0–100 score sits at the top left in large tabular mono, and the factors moving it sit right beside it, ranked by points lost. Trust comes from that adjacency: every number on the page can be traced to the rows beneath it.

Colour is spent only where it carries meaning. The banded score scale (red, orange, amber, light green, green) and a fixed severity ramp are the only chromatic voices; everything structural is grey, ink or hairline. Density is that of a statement, not a dashboard: generous panel padding, hairline-divided rows, small muted labels, mono figures. The system is neutral by commitment: no agency or product branding ever appears.

It must hold up as one offline file with nothing fetched, so its three typefaces (Bricolage Grotesque, Geist and Geist Mono, all SIL OFL, shipped in `skills/seo-supervisor/scripts/fonts/`) are inlined into the file as base64 woff2 at render time. On screen it opens dark; a pill button beside the site name (sun icon plus "Light", or moon plus "Dark") switches theme and remembers the choice in localStorage. It works at phone width, and print always uses the light tokens. Without JavaScript the button stays hidden and the page stays dark. The rejected category default is a KPI-card grid circling a severity donut.

**Key Characteristics:**
- One score, banded scale with a marker, cap note directly beneath.
- Ranked factor rows: severity dot, name and area score, top issue, neutral points-lost bar, mono figure.
- Hairline module grid; flat panels in light, a soft lift in dark.
- One severity ramp (colour and dot size) reused in every chart, legend, row and filter.
- Fixed findings stay in the list, carrying a green FIXED stamp.
- Every figure is tabular mono.

## Colors

Cool form-stock neutrals with one working blue; chroma is reserved for the score bands and severity.

### Primary
- **Working Blue** (working-blue): tabs' selected underline, links, focus rings, "How to fix" heading, the open finding's outline, caret. Its soft tint (working-blue-soft) fills only the "How to fix" callout. Dark: #7ea2ff / #1b2640.

### Secondary: Score Bands
- **Critical Red, Poor Orange, Fair Amber, Good Green, Excellent Green** (band-critical through band-excellent): the five segments of the score scale, 0–39 / 40–59 / 60–74 / 75–89 / 90–100. Text-safe inks (band-critical-ink, band-poor-ink, band-excellent-ink) colour the big score number, the band chip and up/down deltas. Fair and Good scores print the number in ink, not band colour. Dark: #ef6464, #f38b4a, #efb93b, #86c873, #45b97a.

### Tertiary: Severity Ramp
- **Blocker Red** (sev-blocker), **High Orange** (sev-high), **Decision Violet** (sev-decision), **Medium Amber** (sev-medium), **Low Slate** (sev-low), **Passed Green** (passed). Used for dots, stacked severity bars and legends. Violet is the decision colour everywhere: dot, status pill, decision callout heading, recommendation label. Dark: #ef6464, #f38b4a, #a587ec, #efb93b, #8c99ab, #45b97a.

### Neutral
- **Form Ground** (ground): page background, sticky toolbar, table header, dimmed finding cards, code chips. Dark #0e131a.
- **Panel White** (panel): every panel and finding card. Dark #151c26.
- **Ink** (ink): text, score marker, pressed segment button. Dark #e6ebf2.
- **Ink Secondary** (ink-secondary): cap note, stat headings, fixed finding titles, the "with open findings" bar. Dark #c3ccd8.
- **Mute** (mute): meta line, labels, sublines, tick numbers. Dark #98a3b3.
- **Hairline** (hairline) and **Hairline Strong** (hairline-strong): panel borders and row dividers; control borders and the "still open" bar. Dark #232c39 / #323d4d.
- **Neutral Bar** (neutral-bar): the fill of every points-lost meter. Dark #6b7788.

### Named Rules
**The Two Voices Rule.** Only the score bands and the severity ramp carry chroma. Structure, points-lost meters, and chrome stay grey, ink or blue.

**The Colour Plus Shape Rule.** Severity is never colour alone: the dot shrinks with severity (blocker 12px, high and decision 10px, medium 8px, low 7px, passed 8px) and always sits beside its text label.

## Typography

**Display Font:** Bricolage Grotesque (fallback Geist, then the system sans)
**Body Font:** Geist (with system-ui, -apple-system, Segoe UI, Roboto, Arial)
**Label/Mono Font:** Geist Mono (with ui-monospace, SFMono-Regular, Menlo, Consolas)

**Character:** A characterful grotesque for the two moments that carry the page (the site name and the score), a clean neo-grotesque for every word, and its mono sibling for every figure. All three are embedded in the HTML as base64 woff2 (latin subset, variable weight), so the file stays offline and works from an email attachment. They're about 130 KB together.

### Hierarchy
- **Display** (Bricolage Grotesque 700, clamp(80px, 10vw, 124px), 0.86, -0.04em, lining numerals): the score only, followed by "/100" in Geist Mono 500 22px muted.
- **Headline** (Bricolage Grotesque 700, clamp(26px, 3.4vw, 34px), -0.02em): the site name in the header.
- **Title** (600, 15–16.5px, 1.4): panel headings (16.5px), finding titles (15.5px), decision questions (16.5px). Tabs are 600 14.5px.
- **Body** (400, 15px, 1.55): prose; finding bodies capped at 70ch, lede at 78ch. Secondary text steps to 13.5px muted.
- **Label** (600, 12.5px, 0.02em, muted, sentence case): "What's wrong", "Why it matters", "Evidence", severity labels, table headers (12px).
- **Figure** (mono 600): stat numbers 26px, points-lost 16px, area scores 12.5px muted, counts 12–12.5px.

### Named Rules
**The Tabular Figures Rule.** Body sets `font-variant-numeric: tabular-nums`, and every standalone number (stats, points, counts, rule IDs, ticks) is in Geist Mono. The one exception is the score, which is the display face.

**The Sentence Case Rule.** Labels and headings are sentence case. The FIXED stamp is the one uppercase element.

## Layout

A centred column, max 1240px, with a 20px gutter that respects safe-area insets. The header is a white band (site name, dotted meta line, lede, tabs) over the grey ground. Panels sit 18px apart; main content has 26px top and 56px bottom padding.

The overview is a 5:7 two-column grid: score panel and a three-cell stats panel stacked left, "What's moving your score" right, then a full-width "Fix first" panel. Ranked rows use a fixed grid (14px dot column, flexible text, 80–160px meter, 64px figure) with 11px vertical padding and hairline dividers between rows; hover tints a row with the ground colour.

Below 900px the overview, stats dividers and finding body columns collapse to one column. Below 560px the stats panel stacks, meters hide, panel padding drops to 18px, the tab strip fades out its right edge, and finding status moves under the title. The findings toolbar is sticky at the top of the viewport. Without JavaScript, all tab panels render in sequence with their titles; in print, tabs, toolbar and score explainer hide and every finding body expands.

## Elevation & Depth

Flat in light mode: depth is hairline borders and the ground/panel tonal step, with `box-shadow: none`. In dark mode panels and finding cards lift slightly so they separate from the near-black ground.

### Shadow Vocabulary
- **Dark panel lift** (`box-shadow: 0 1px 2px rgba(0,0,0,.3), 0 6px 18px rgba(0,0,0,.25)`): panels and finding cards in dark mode only.
- **Open finding ring** (`box-shadow: 0 0 0 1px var(--blue)` with a blue border): the expanded finding, a 2px blue outline in effect.
- **Marker halo** (`box-shadow: 0 0 0 2px var(--panel)`): separates the score marker from the scale segments.

### Named Rules
**The Hairline Rule.** Structure is drawn with 1px hairlines, not shadows. In light mode nothing casts a shadow.

## Shapes

Gently rounded throughout: panels and finding cards 10px, controls and callouts 8px, hoverable rows and the score track 6px, code chips and the FIXED stamp 5px, pills (tab counts, band chip, status) fully round. Bars are round-ended (meters 4px, stacked bars 5px). The score scale is five discrete segments with 2px gaps, not a blended gradient. The FIXED stamp is the one rotated form, tilted -2deg with a 1.5px border.

## Components

### Tabs
- **Style:** text-only buttons, 600 14.5px, muted, 26px apart, with a mono count pill (ground fill, hairline border).
- **Selected:** ink text and a 2px working-blue underline. Hover moves to ink.
- **Keyboard:** arrow keys, Home and End move between tabs; the hash routes to a tab or a finding.

### Score Panel (signature)
- Panel heading, then the score in Display type coloured by band ink, a band chip plus one-line verdict, the banded scale, the cap note in ink-secondary, an optional up/down delta (the total's change, or the checked-rules change when the blocker cap holds the total still), and a "How this score works" disclosure in working blue.
- **Banded scale:** 12px track of five segments; a 3px ink marker 28px tall with a mono number flag above; mono ticks at 0, 40, 60, 75, 90, 100.

### Factor Rows (signature)
- "What's moving your score", subtitled "Points lost, biggest first". Each row: severity dot of the area's worst open finding, area name with mono area score, top issue on one ellipsised line, a neutral 8px meter scaled to the largest loss, and a mono "−N pts" figure. A blocker-cap row leads when blockers cap the score; a passing-areas row with a green dot and green "0" closes the list.

### Stats Panel
- One panel split into three cells by vertical hairlines (horizontal when stacked): open issues with a severity stack and legend, fixed this run, rules checked. Each cell: 13.5px heading, 26px mono figure with muted context, a 10px stacked bar.

### Filter Toolbar
- Sticky, on the ground colour with a bottom hairline. Search field (8px radius, strong hairline, inline search icon, blue focus outline on the wrapper), severity segment buttons with dot and mono count (pressed = ink fill, panel text), native selects for status and area, and a live "N of M findings" count at the right.

### Finding Cards
- **Collapsed:** panel card, 14px 18px padding; grid of dot, title (15.5px 600), meta line (severity, area, mono rule ID, mono count), status pill or FIXED stamp, and a chevron that rotates 90deg on open (0.2s, cubic-bezier(.2,.8,.2,1)).
- **Focus mode:** when any finding is open, the others drop to the ground colour and their dots to 55% opacity; hover restores them.
- **Open body:** two columns ("What's wrong" and "Why it matters"; then the fix callout, decision callout, or done callout), followed by an evidence table of at most 10 rows in a hairline-bordered wrapper.
- **Fixed:** title in ink-secondary, a green uppercase FIXED stamp with a check icon. Fixed findings stay in the list.

### Callouts
- 8px radius, 12px 14px padding, tinted fill, heading coloured to match: "How to fix" (blue soft / blue), "Decision needed" and recommendations (decision soft / violet), "What was done" (passed soft / green).

### Status Pill
- 600 12px, ink-secondary on transparent, strong hairline border, full pill. "Needs decision" turns violet text and border.

## Do's and Don'ts

### Do:
- **Do** put the reason for a number directly beside or beneath it: the cap note under the score, ranked factors next to it.
- **Do** reuse the one severity ramp, dot sizes included, in every chart, legend, filter and row.
- **Do** set every figure in the mono stack with tabular numerals.
- **Do** keep points-lost meters in the neutral bar colour; the dot carries the severity.
- **Do** keep fixed findings visible with the FIXED stamp instead of removing them.
- **Do** draw structure with 1px hairlines and 10px-radius white panels on the cool grey ground.
- **Do** pair every colour signal with a text label or shape.

### Don't:
- **Don't** build a KPI-card grid around a severity donut.
- **Don't** add colour gradients; the score scale is discrete bands, and the only other gradient is the mobile tab strip's fade mask.
- **Don't** cast shadows in light mode.
- **Don't** fetch anything at view time (fonts, scripts or images); the three faces are inlined from `skills/seo-supervisor/scripts/fonts/`. **Don't** add a fourth face.
- **Don't** add agency, company or product branding.
- **Don't** imply a benchmark or industry average next to a score.
