---
name: Release Control
description: Release board for the orca-release skills inside Orca — a constellation of projects where state is light.
colors:
  state-dirty: "#b98110"
  state-dirty-dark: "#e2b440"
  state-unpushed: "#d9541e"
  state-unpushed-dark: "#ff8a52"
  state-unreleased: "#3a6be0"
  state-unreleased-dark: "#82a8ff"
  state-recipe: "#8a55d6"
  state-recipe-dark: "#b994ff"
  state-clean: "#2c8a57"
  state-clean-dark: "#52c78f"
  state-missing: "#8a8f98"
  ground: "var(--orca-background)"
  surface: "var(--orca-card)"
  ink: "var(--orca-foreground)"
  ink-muted: "var(--orca-muted-foreground)"
  rule: "var(--orca-border)"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  section:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  star-label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  data:
    fontFamily: "SF Mono, ui-monospace, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
rounded:
  control: "6px"
  card: "var(--orca-radius)"
  pill: "999px"
spacing:
  row: "7px"
  gap: "10px"
  section: "22px"
  drawer-x: "18px"
components:
  button:
    backgroundColor: "var(--orca-secondary)"
    textColor: "var(--orca-secondary-foreground)"
    rounded: "{rounded.control}"
    height: "28px"
    padding: "0 11px"
  button-primary:
    backgroundColor: "var(--orca-primary)"
    textColor: "var(--orca-primary-foreground)"
    rounded: "{rounded.control}"
    height: "28px"
  chip:
    rounded: "{rounded.pill}"
    height: "26px"
    padding: "0 10px"
  chip-pressed:
    backgroundColor: "var(--orca-accent)"
    rounded: "{rounded.pill}"
---

# Design System: Release Control

## Overview

Release Control lives inside Orca and wears Orca: ground, surfaces, text, borders, focus rings and controls all come from the active theme's `--orca-*` variables, so the board follows light and dark without a reload. The plugin owns two things only: the state colours and the constellation.

The constellation is the signature. Each project is a star sized by its last 12 weeks of commits, linked to the technologies it uses. State is light: a ring split into one segment per state, and a soft corona only when there is release work waiting (commits to publish, commits after the last tag, a stale recipe). Unsaved files are everyday work, so they get a ring but no corona. A clean project is a quiet disc with a small green core. When everything is clean, the map is calm. When one project needs a release, it is the only one that burns.

Mode: Operate. The board stays open all day, so it is fast, quiet and scannable before it is expressive.

## Colors

### State (the only loud colours)
- **Uncommitted** `state-dirty` amber: unsaved files in the checkout or a worktree.
- **To push** `state-unpushed` orange: commits not on the remote, including on branches never pushed.
- **To release** `state-unreleased` blue: commits after the last version tag. Blue also draws the activity charts.
- **Recipe** `state-recipe` violet: recipe drift found by `/align`. Also the graphify community bars.
- **Clean** `state-clean` green: the core of a clean star and the "all clear" callout.

Each state has a light and a dark value, switched by the `dark` class Orca puts on `<html>`.

### Neutral
Everything else is Orca's: `--orca-background` for the map ground, `--orca-card` for the drawer, `--orca-foreground` and `--orca-muted-foreground` for text, `--orca-border` for rules and links between stars.

### Named Rules
**The Light Means Work Rule.** Only a project with release work waiting glows. Never add a corona, glow or tint for decoration or for unsaved files.
**The One Meaning Rule.** A state colour means its state everywhere: filter chips, ring segments, list dots, the legend. Do not reuse a state hue as a series or brand colour.

## Typography

One family, the platform's system sans, at a tight product scale: 18/600 for the project title in the drawer, 13/400 body, 12/600 for section headings and star labels, 11/500 for technology labels. Numbers are tabular. Monospace is only for data: branches, paths and tags.

### Named Rules
**No Eyebrows Rule.** Section headings name the section ("Now", "Skills", "State"). There are no kickers, no all-caps labels and no numbering.

## Layout

The top bar is 48px: title, filter chips with counts, technology select, freshness and refresh, and "Status". Below, two work areas: the map takes the remaining width, and the drawer is `clamp(360px, 32vw, 440px)` wide. Below 820px they stack: the map takes 300px–48vh and the drawer follows; the legend hides because the chips carry the colours. The drawer is a column of sections 22px apart, with list rows separated by hairlines.

## Elevation & Depth

The board is flat: a hairline separates the drawer, and rows are divided by rules. The only shadow is on the toast (`0 6px 18px -6px rgb(0 0 0 / .25)`), the one element floating above the map. Depth on the map comes from light: coronas behind release stars, halos behind labels so they read over links.

## Shapes

Controls have a 6px radius; filter chips are pills; callouts use Orca's `--orca-radius`. Stars are circles, the state ring is round-capped, 3.5px wide, with 0.22rad gaps between segments.

## Components

### Buttons
Orca's secondary style at 28px (24px `sm` in rows). Primary (`--orca-primary`) marks the one action the state asks for, e.g. Push when there are commits to publish. Press feedback is `scale(.97)` over 160ms `cubic-bezier(.23,1,.32,1)`. Hover only on fine pointers. Busy buttons show `aria-busy` and stay disabled until the agent starts.

### Chips
Filter chips: a dot in the state colour, a label and a tabular count. Pressed means `--orca-accent`. Disabled at count 0.

### Rows
Attention rows: a state dot, the project in bold, the reason in muted text, and the skill button on the right. In the overview a row selects its project, and hovering a row rings its star on the map.

### Constellation (signature)
Canvas, drawn from theme colours read at runtime and normalised through a 1px canvas, so any CSS colour format works. Force layout scaled to the canvas, with collision on label widths. It settles off-screen, so opening the board plays no intro. Dragging a star moves it, and letting go springs it back. Pressing a technology filters to its projects. Under reduced motion the layout is computed once and drawn statically.

### Domains, links and layers
Projects with the same `domain` drift together inside a soft zone: a padded convex hull in `--orca-muted` at low alpha
with a hairline border and the domain label above its highest point. Non-members are pushed out of the zone. Typed links
are arrows from rim to rim: `uses-api` solid, `follows` dotted, `replaces` dashed, `related` thin; mutual pairs curve
apart; the type appears as a word only on hover or selection. External systems (`ext:`) are small hollow nodes with an
italic label. None of this uses a state colour. A segmented control in the map's top-right switches Technologies /
Dependencies: technology spokes are hidden by default once links exist ("Show technologies" brings them back); the
Dependencies map shows only the shared dependencies whose versions differ (dashed spoke = the odd version), and the
drawer holds the full projects × dependencies table with odd versions underlined. Positions are saved and restored;
"Re-arrange" lays the map out again. Hovering a star or a zone dims everything outside its neighbourhood (~120 ms).

### Drawer
With nothing selected: Now, the commits per week (every project as a quiet line, the total as a blue area, the chosen series lit), the project list and the Monday report. With a project selected: Now, the skill buttons and the new-task box, the facts list, weekly bars and the graphify community map. Content crossfades in 120–140ms on a selection change; the first selection does not animate.

## Do's and Don'ts

### Do:
- Do take every neutral from `--orca-*` and redraw the canvas on Orca's `theme` event.
- Do make every action the real skill (`/push`, `/deploy <target>`…) launched in the project's own workspace.
- Do keep motion to state changes: press feedback, the drawer crossfade, the toast, and the star springing back.

### Don't:
- Don't add a corona or glow that doesn't mean release work.
- Don't run anything irreversible from the board; the skill asks for confirmation.
- Don't animate the board opening or keyboard actions.
- Don't use monospace for prose, or state colours for decoration.
