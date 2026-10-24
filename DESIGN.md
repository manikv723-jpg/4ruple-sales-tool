---
name: 4ruple.ai
description: A light GTM workbook in the Clay and Bitscale register, by Basement Protocol.
colors:
  page: "#F6F5F2"
  sidebar: "#FBFAF8"
  panel: "#FFFFFF"
  subtle: "#F4F3EF"
  hover: "#EFEDE8"
  line: "#E8E6E1"
  line-strong: "#D9D6CE"
  row-hover: "#FAF9F6"
  row-selected: "#F3F6FF"
  ink: "#1A1916"
  ink-2: "#5F5B53"
  ink-3: "#716D64"
  ink-disabled: "#9C988F"
  control-off: "#D2CEC5"
  check-border: "#B4B0A6"
  blue: "#4D7CFF"
  blue-ink: "#2F5BEA"
  blue-tint: "#EEF2FF"
  blue-line: "#C9D6FF"
  black: "#1A1916"
  black-hover: "#34322D"
  grey-bg: "#F1F0EC"
  grey: "#5F5B53"
  lilac-bg: "#F2ECFD"
  lilac: "#6B3FBF"
  amber-bg: "#FDF2DB"
  amber: "#8A5A00"
  amber-dot: "#D08A00"
  green-bg: "#E7F4EC"
  green: "#1E7A3E"
  sky-bg: "#E9F0FF"
  sky: "#2F5BEA"
  red-bg: "#FDECEA"
  red: "#B42318"
  teal-bg: "#E3F4F4"
  teal: "#0E6B72"
typography:
  wordmark:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  contact-title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.02em"
  paper-name:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.35
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.01em"
  mail-body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.7
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  control:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.3
  mono:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  mono-count:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.3
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  main-y: "28px"
  main-x: "32px"
  main-x-phone: "16px"
  gap: "16px"
  cell: "8px 12px"
  panel-pad: "20px"
  paper-pad: "24px 28px 28px"
  sidebar-w: "248px"
components:
  button-primary:
    backgroundColor: "{colors.black}"
    textColor: "{colors.panel}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "34px"
  button-primary-hover:
    backgroundColor: "{colors.black-hover}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "34px"
  button-secondary-hover:
    backgroundColor: "{colors.subtle}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
  button-ghost-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.ink}"
  button-small:
    rounded: "{rounded.pill}"
    padding: "0 11px"
    height: "28px"
  button-disabled:
    backgroundColor: "{colors.subtle}"
    textColor: "{colors.ink-disabled}"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 11px"
  nav-item:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    height: "34px"
    padding: "0 10px"
  nav-item-active:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
  nav-item-active-phone:
    backgroundColor: "{colors.blue-tint}"
    textColor: "{colors.blue-ink}"
  view-tab:
    textColor: "{colors.ink-2}"
    typography: "{typography.control}"
    height: "44px"
  view-tab-active:
    textColor: "{colors.ink}"
  count-active:
    backgroundColor: "{colors.blue-tint}"
    textColor: "{colors.blue-ink}"
    typography: "{typography.mono-count}"
    rounded: "{rounded.pill}"
  chip-new:
    backgroundColor: "{colors.grey-bg}"
    textColor: "{colors.grey}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "22px"
    padding: "0 8px"
  chip-writing:
    backgroundColor: "{colors.lilac-bg}"
    textColor: "{colors.lilac}"
  chip-ready:
    backgroundColor: "{colors.amber-bg}"
    textColor: "{colors.amber}"
  chip-approved:
    backgroundColor: "{colors.green-bg}"
    textColor: "{colors.green}"
  chip-queued:
    backgroundColor: "{colors.sky-bg}"
    textColor: "{colors.sky}"
  chip-error:
    backgroundColor: "{colors.red-bg}"
    textColor: "{colors.red}"
  mode-chip-preview:
    backgroundColor: "{colors.amber-bg}"
    textColor: "{colors.amber}"
    rounded: "{rounded.pill}"
    height: "26px"
    padding: "0 10px"
  mode-chip-live:
    backgroundColor: "{colors.green-bg}"
    textColor: "{colors.green}"
  bulk-bar:
    backgroundColor: "{colors.black}"
    textColor: "{colors.panel}"
    rounded: "{rounded.pill}"
    padding: "4px 6px 4px 16px"
  segmented-on:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.blue-ink}"
    rounded: "{rounded.sm}"
    height: "28px"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.lg}"
  toast:
    backgroundColor: "{colors.black}"
    textColor: "{colors.panel}"
    rounded: "{rounded.lg}"
    padding: "10px 16px"
---

# Design System: 4ruple.ai

## Overview

**Creative North Star: "The Warm Workbook"**

4ruple.ai is a light GTM workbook that sits beside Clay and Bitscale: a warm off-white page, white rounded panels, spreadsheet-grade tables with numbered rows, pastel state chips, black pill actions. It belongs to Basement Protocol and carries the parent's grammar: the Fourth Step mark (three stepped L-squares plus one blue square), Geist and Geist Mono, and a single blue.

Density is spreadsheet density, not dashboard density: 13px table text, 54px rows, hairline borders, no hero areas and no metric cards. Colour carries state only. Everything a person decides on (who to write to, what to approve, what gets sent) sits in one white panel at a time; the floating finder, the right drawer and the toast are the only things that lift off the page. The world refuses the dark dev-tool dashboard and the KPI-card sales dashboard.

**Key Characteristics:**
- Warm neutral ground, white panels, 1px warm hairlines.
- One blue (Basement Protocol #4D7CFF) for selection, focus, active state and the logo square.
- Black pill for the one primary action per area.
- Pastel status chips: tint background, deep same-hue text, dot, one plain word.
- Geist for UI; Geist Mono for machine values (emails, counts, times, row numbers).
- Preview or live sending mode is visible on every screen.

## Colors

Warm greys and white with one blue and a set of pastel state pairs; nothing else.

### Primary
- **Basement Blue** (blue): selected checkboxes, switch on, active nav icon, view-tab underline, step dots done, setup progress bar, focus outline, dropzone hover border, and the fourth square in the mark. Never a button fill.
- **Blue Ink** (blue-ink): links, active counts, the on segment, phone active nav label. Text-safe (5.4:1 on white).
- **Blue Tint / Blue Line** (blue-tint, blue-line): current Review queue item, active count pill, on toggle chip, segmented on border. Focus ring is blue at 30% alpha, 3px, on inputs.
- **Pill Black** (black, black-hover): primary buttons, the bulk bar, the toast, the skip link. Same value as ink.

### Secondary (state pairs)
Each pair is a tint background with a deep text of the same hue; the chip dot takes the text colour.
- **Stone** (grey-bg / grey): new, not sent, not interested.
- **Lilac** (lilac-bg / lilac): writing.
- **Amber** (amber-bg / amber): to review; Preview mode chip; notice bars and hook warnings. **Amber Dot** (amber-dot) is the sidebar preview indicator.
- **Green** (green-bg / green): approved, interested, done, connected; Live sending.
- **Sky** (sky-bg / sky): queued, sent, waiting.
- **Red** (red-bg / red): error, bounced; error box and error toast text.
- **Teal** (teal-bg / teal): avatar palette only.

### Neutral
- **Warm Ground** (page): page and topbar background, theme colour.
- **Sidebar Paper** (sidebar): the sidebar only.
- **Panel White** (panel): panels, inputs, buttons, drawer, phone bottom nav.
- **Subtle** (subtle): table header, count pills, segmented track, secondary hover, disabled fill.
- **Hover** (hover): nav, ghost and icon-button hover.
- **Line / Line Strong** (line, line-strong): hairlines between rows and sections; control borders.
- **Row Hover / Row Selected** (row-hover, row-selected): table row states; selected rows lean blue.
- **Ink scale** (ink 17.1:1, ink-2 6.6:1, ink-3 5.0:1 on white): text, secondary text, meta and icons. **Ink Disabled** for disabled labels; **Control Off** for the off switch and scrollbar thumb; **Check Border** for unchecked boxes.

The direction contract listed ink-2 #6B6860, ink-3 #8C887F and line #DDDAD3; the build darkened them for contrast, and the build values are normative.

### Named Rules
**The One Blue Rule.** Blue means "selected, focused or current". It never fills a button, never decorates, and no second accent hue exists.

**The Chip Pair Rule.** State colour appears only as a pastel pair from the set above, with a dot and a plain word. Add a state by reusing a pair, not a new hue.

## Typography

**Body Font:** Geist (with ui-sans-serif, system-ui), self-hosted variable woff2.
**Label/Mono Font:** Geist Mono (with ui-monospace, SF Mono, Menlo).

**Character:** Geist sets a quiet, even workbook voice at 400/500/600 with slight negative tracking on headings; Geist Mono marks anything a machine produced.

### Hierarchy
- **Headline** (600, 24px, 1.25, -0.02em): page title in the page heading, with a mono count pill inline.
- **Contact title** (600, 20px): person name in the drawer.
- **Paper name** (600, 17px): person name atop the Review paper.
- **Title** (600, 15px, 1.35): panel and card titles (h2); h3 is 600 14px.
- **Mail body** (400, 15px, 1.7): editable email in Review; subject is 600 15px. Follow-ups drop to 14px.
- **Body** (400, 14px, 1.5): inputs, ledes (ink-2, max 70ch), setting rows.
- **Control** (500, 13px): buttons, view tabs, segmented, table text is 13px 400.
- **Label** (500, 12px): chips, table headers, nav group labels, context panel titles, sentence case in ink-3.
- **Mono** (400 or 500, 11-12px): emails, row numbers, counts, times in the Activity cell, setup fraction, numeric inputs, hook score; stat-style numbers use tabular figures.

### Named Rules
**The Mono For Machines Rule.** Mono is for emails, counts, row numbers and times only. Names, copy, headings and labels stay in Geist.

**The Sentence Case Rule.** Group labels and panel labels are sentence case at 12px 500 in ink-3; there are no uppercase tracked labels.

## Layout

App shell: a fixed 248px sidebar (224px at 1080 and below) and a content column with a sticky 56px topbar (breadcrumb left; pipeline tally and sending-mode chip right). `main` is max 1360px, padded 28px 32px 72px.

**Page heading pattern:** title plus mono count pill and a one-line lede on the left, heading actions right-aligned to the bottom (secondary pills, then the black primary). 20px below it the content panels begin.

**Views:**
- Leads: one full-width table panel.
- Review: three columns, queue 260px, paper flexible, context 300px, gap 16px; queue and context stick at 72px from top.
- Outreach: sending-plan line panel, then a split of table and 380px schedule panel.
- Your firm: a 880px stack of form cards.
- Settings: two columns of integration cards.

**Breakpoints:**
- 1240px: Review becomes queue 230px plus paper, context drops below the paper; Outreach split stacks.
- 1080px: sidebar 224px; integrations one column; topbar tally hidden.
- 760px: sidebar becomes a 56px sticky top bar with the lockup only; nav moves to a fixed bottom bar of five equal 48px tabs (icon over 11px label, safe-area padded, active in blue tint); topbar sits under it at 44px; main 20px 16px 96px; heading actions go full width; toolbar stacks with full-width search; Leads and Outreach table rows stack into grid cards; Review queue becomes a horizontal strip of 220px items; form grids go single column; toast lifts to 84px above the bottom nav.

Rhythm is 4px based in practice: 6/8/10/12 inside controls, 16 between panels, 20-24 inside cards.

## Elevation & Depth

Flat, tonal and hairline-led. Resting panels get a barely-there 1px shadow so white separates from the warm ground; only things that float over content carry a real shadow.

### Shadow Vocabulary
- **Card** (`box-shadow: 0 1px 2px rgba(26, 25, 22, .04)`): panels, workspace card, setup card, active nav item, segmented on.
- **Float** (`box-shadow: 0 1px 2px rgba(26, 25, 22, .05), 0 12px 32px rgba(26, 25, 22, .10)`): Find people panel, contact drawer, toast.
- **Scrim** (`rgba(26, 25, 22, .22)`): drawer backdrop.

### Named Rules
**The Flat Until Floating Rule.** Only the finder, the drawer and the toast use the float shadow. Nothing on the page surface lifts on hover.

## Shapes

Soft rectangles and pills. Controls and inner containers round at 8px (6px for segmented segments and company logos, 4px for checkboxes and key caps), panels at 12px, and every button, chip, count, mode chip and the bulk bar is a full pill. Avatars are circles; workspace and integration icons are 28-36px rounded squares. Borders are 1px warm hairlines; dashed 1.5px borders mark only the CSV dropzone and the Preview chip. The Fourth Step mark is square geometry, ink with one blue square; the favicon is the same mark in page colour on an ink 12px-rounded tile.

## Components

### Buttons
Calm pills with one black voice.
- **Shape:** full pill, 34px tall, 13px 500, 15px SVG icons.
- **Primary:** black fill, white text; hover to black-hover; active nudges down 1px.
- **Secondary:** white with line-strong border; hover subtle.
- **Ghost:** transparent, ink-2; hover hover fill.
- **Small:** 28px, 12px text (row actions such as Send preview, Update email and deck).
- **Disabled:** subtle fill, line border, ink-disabled text, no transform.
- **Link:** blue-ink text, underline on hover; subtle variant in ink-2. Icon buttons are 30px, 8px radius, ink-3.
- **Send labels say what will happen:** in Preview mode the Outreach primary reads "Send N previews to your inbox" and row actions read "Send preview"; live it reads "Send to N people" / "Send now", and a live send asks for confirmation first.

### Chips
- **Status chip:** 22px pill, 12px 500, 6px dot in currentColor, state pair colours. Writing pulses its dot.
- **Preview chip:** transparent with a dashed line-strong border and no dot, marks a preview-only send.
- **Plain chip:** subtle fill, no dot; used for the hook score (mono bold score out of 10) and pitch role.
- **Toggle chip:** 30px outlined pill with a checkbox; checked turns blue tint, blue line, blue ink.
- **Mode chip:** amber "Preview mode" or green "Live sending", in the topbar, linking to Outreach.

### Cards / Containers
- **Panel:** white, 1px line, 12px radius, card shadow. Padding by use: 20px integration cards, 22px 24px form cards, 18px 20px schedule, 24px 28px Review paper, 14px context cards.
- **Notice bar / error box:** 8px radius amber or red pair, 13px text, no border.
- **Empty state:** centred, 56px vertical padding, 46ch copy and one action.

### Inputs / Fields
- **Style:** white, line-strong 1px border, 8px radius, 8px 11px padding, 14px text; labels 13px 500 above with an optional ink-3 hint.
- **Focus:** border turns blue plus a 3px blue ring at 30%.
- **Disabled:** subtle fill, ink-2 text.
- **Checkbox:** 16px, 4px radius, blue fill when checked or indeterminate.
- **Switch:** 34 by 20px pill, control-off grey, blue when on.
- **Select:** custom chevron; in the toolbar a 32px pill select.
- **Search:** 280px, 32px, leading icon, whole box takes the focus ring.

### Navigation
- **Sidebar:** lockup (mark, 16px wordmark, "by Basement Protocol" in 12px ink-3), workspace card, group labels "Pipeline" and "Workspace", 34px nav items with 17px line icons and mono count pills, then the setup progress card and the sending-mode line pinned to the bottom (amber dot "Preview mode / Emails come to your inbox", green when live).
- **Active item:** white fill, line border, card shadow, blue icon, blue-tint count.
- **Topbar:** breadcrumb "Workspace > View", tally of pipeline counts with mono numbers, mode chip.
- **Phone:** bottom nav as above.

### Workbook Table (signature)
- **View tabs:** 44px tabs with mono count pills; active tab ink with a 2px blue underline and blue-tint count.
- **Toolbar:** search, company and sort pill selects, selection hint. Selecting rows replaces the whole toolbar with the **bulk bar**: a black pill with "N selected", a white pill action ("Write N emails") and a Clear text button.
- **Header row:** 36px, subtle fill, 12px 500 ink-2 with 13px line icons.
- **Rows:** 54px, 13px, tabular numbers. Columns: checkbox, mono row number, person (pastel avatar with initials, 600 name, 12px role), company (22px logo tile, name, ink-3 domain), mono email, status chip, Activity cell (plain words plus a mono time, such as "Draft written 1:04"), arrow action. Hover row-hover; selected row-selected.
- **Avatars:** 30px circles, colour picked deterministically from six pairs (sky, lilac, green, amber, red, teal).
- **Company logos:** 22px, 6px radius, hairline border, white; the image removes itself on error.
- **Footer:** 12px ink-3 "Showing N of N people" and a hint.
- **Phone:** header hidden; each row is a grid card, checkbox and name with status on top, company, email and activity below.

### Find People Panel
Floats 8px under the black Find people pill, right aligned, up to 520px wide, 12px radius, float shadow, rises 4px in 180ms. Header holds the **Companies | Upload CSV** segmented switch (subtle track, white on segment with blue line and blue ink) and a close icon. Companies: a note, a textarea, a firm-profile link and a black Find people pill. Upload CSV: a dashed dropzone that turns blue tint on hover.

### Review
Three columns: **queue** panel (items with avatar, company and status chip; current item blue tint with blue line); **paper** (avatar, name, role, status chip; hook chips; a mail block with To in mono and Subject rows, then the body on white; follow-ups as smaller mail blocks labelled with timing; shimmer lines while writing); **context** column (deck thumbnail with "Open the 4-page deck" link, sources as blue links, ask-for-a-change textarea with a secondary button, decision panel with a full-width primary Approve and key caps for A, J, K).

### Outreach
- **Sending plan line:** one panel row with a clock icon and inline facts ("2 people ready to send", "0 of 50 sent today", sending hours and time zone, what happens next). Plain text, no metric cards.
- **Step sequence:** Email, Follow-up 1, Follow-up 2 always shown; 10px ring dots joined by short rules; done is filled blue, next is blue-ringed tint with its send time.
- **Schedule panel:** setting rows divided by hairlines: Preview mode switch with its consequence ("Emails come to your inbox" / "Emails go to real people"), follow-up days as 56px mono number inputs, sending hours as time inputs, daily limit, weekends switch.

### Integration Cards
Settings cards with a 36px subtle icon tile, title with a green "Connected" chip, a note, then fields. Provider rows (Apollo, Prospeo, Hunter) use 32px letter tiles beside each key field, divided by hairlines; a do-not-contact card shows a mono count.

### Drawer
Native dialog pinned right, 460px, full height, left hairline, float shadow, slides 12px in 200ms over a warm scrim. 56px top bar, 48px avatar, 20px name, definition-list facts, draft preview with "Open in Review", footer meta.

### Toast
Bottom-centre black 12px-radius bubble, 13px white text, float shadow, rises in. Error variant is white with a pale red border and red text.

## Do's and Don'ts

### Do:
- **Do** keep the page warm ground with white 12px panels and 1px line hairlines.
- **Do** give each heading area one black pill primary; everything else is secondary, ghost or link.
- **Do** use blue only for selection, focus, current and progress.
- **Do** express every state as a pastel chip pair with a dot and a plain word.
- **Do** set emails, counts, row numbers and times in Geist Mono, everything else in Geist.
- **Do** label send actions by their real effect: previews to your inbox in Preview mode, people in live mode.
- **Do** keep the sending mode visible in both the sidebar foot and the topbar on every view.
- **Do** stack table rows into grid cards at 760px and move nav to the bottom bar.
- **Do** keep motion at 150-200ms with the shared ease, and remove it under reduced motion.

### Don't:
- **Don't** add a second accent hue or colour outside the chip pairs.
- **Don't** fill buttons with blue.
- **Don't** build metric cards or KPI tiles; pipeline numbers live in counts, the tally and the sending-plan line.
- **Don't** put a float shadow on resting panels or lift anything on hover.
- **Don't** use a dark theme surface or the dark dev-tool dashboard look.
- **Don't** use uppercase tracked labels above headings.
- **Don't** let a table scroll sideways on a phone when its rows can stack.
