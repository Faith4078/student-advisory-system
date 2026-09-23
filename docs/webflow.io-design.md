---
version: alpha
name: Webflow Modern
description: A clean, high-contrast SaaS marketing system with bold typography, bright blue accents, and restrained surfaces.
colors:
  primary: "#146ef5"
  secondary: "#080808"
  tertiary: "#d8d8d8"
  neutral: "#ffffff"
  surface: "#f0f0f0"
  on-surface: "#080808"
  error: "#d92d20"
  border: "#d8d8d8"
  muted: "#6b7280"
  tint: "#eef4ff"
typography:
  headline-display:
    fontFamily: "WF Visual Sans Variable"
    fontSize: "64px"
    fontWeight: 600
    lineHeight: 1.04
    letterSpacing: "-0.64px"
  headline-lg:
    fontFamily: "WF Visual Sans Variable"
    fontSize: "45px"
    fontWeight: 600
    lineHeight: 1.04
    letterSpacing: "0px"
  headline-md:
    fontFamily: "WF Visual Sans Variable"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0px"
  headline-sm:
    fontFamily: "WF Visual Sans Variable"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.22
    letterSpacing: "0px"
  body-lg:
    fontFamily: "WF Visual Sans Variable"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "0px"
  body-md:
    fontFamily: "WF Visual Sans Variable"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0px"
  body-sm:
    fontFamily: "WF Visual Sans Variable"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0px"
  label-lg:
    fontFamily: "WF Visual Sans Variable"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0px"
  label-md:
    fontFamily: "WF Visual Sans Variable"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0px"
  label-sm:
    fontFamily: "WF Visual Sans Variable"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0px"
rounded:
  none: 0px
  sm: 4px
  md: 8px
  lg: 12px
  xl: 16px
  full: 9999px
spacing:
  xs: 8px
  sm: 16px
  md: 24px
  lg: 52px
  xl: 88px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.sm}"
    padding: "16px 24px"
    height: "58px"
  button-secondary:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.sm}"
    padding: "16px 24px"
    height: "58px"
  button-link:
    backgroundColor: "transparent"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.none}"
    padding: "0px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    padding: "13px"
  input:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.sm}"
    padding: "16px 16px"
  chip:
    backgroundColor: "{colors.tint}"
    textColor: "{colors.primary}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: "4px 8px"
---

## Overview
This system feels polished, confident, and conversion-focused, with a strong enterprise SaaS personality. It balances dense information architecture with generous white space, so the interface feels premium rather than crowded. The tone is professional and energetic, driven by bold headlines and a vivid blue accent that signals action.

## Colors
- **Primary (#146ef5):** A vivid Webflow blue used for key actions, badges, links, and brand emphasis. It carries the interface and provides the strongest interactive signal.
- **Secondary (#080808):** Near-black text used for headlines, nav items, and body copy. It creates crisp contrast on white and light surfaces.
- **Tertiary (#d8d8d8):** A light neutral border tone for dividers, input edges, and subtle framing. It keeps structure visible without feeling heavy.
- **Neutral (#ffffff):** The base canvas for most pages, cards, and buttons. It supports the clean, editorial feel of the layout.
- **Surface (#f0f0f0):** A soft neutral surface used for cards and content panels that need separation from the page background.
- **On-surface (#080808):** The default readable text color on light surfaces, matching the deep brand ink used throughout the site.
- **Error (#d92d20):** Reserved for destructive states and validation feedback; it should remain sparing in a system this restrained.
- **Tint (#eef4ff):** A pale blue wash for pills, announcement accents, and subtle branded highlights.

## Typography
All typography is set in WF Visual Sans Variable, giving the site a modern, compact, and highly legible voice. Headlines use a 600 weight and tight letter spacing for a bold, product-forward presence; the display scale is especially prominent in hero messaging. Body copy stays at 400 weight with a comfortable 1.6 line height for scanning long-form marketing content. Labels and buttons shift to 500 weight for clear hierarchy without the need for all-caps treatment, and uppercase styling is not a defining convention in the observed UI.

## Layout
The layout is centered and spacious, with a strong fixed-max-width marketing rhythm rather than a dense app grid. Large hero margins, stacked content blocks, and wide gutters help the page breathe, while section spacing follows a clear scale of 8px, 16px, 24px, 52px, and 88px. Cards and panels use compact internal padding compared to the generous outer page spacing, creating strong contrast between structure and openness.

## Elevation & Depth
Depth is intentionally minimal. The system relies more on tonal separation, thin borders, and contrast between white, light gray, and black sections than on heavy shadow stacks. When shadow appears, it is very soft and subdued, used sparingly so the brand remains crisp and flat rather than skeuomorphic.

## Shapes
The shape language is simple and controlled, with small radii on interactive elements and slightly larger radii on content containers. Buttons use the 4px corner treatment, which feels architectural and precise, while cards can expand to 8px for a softer presentation. Overall, the system reads as restrained and product-led rather than playful or rounded.

## Components
Buttons are the clearest interactive pattern in the system. Primary buttons (`button-primary`) use solid blue fills, white text, 16px/24px padding, 58px height, and a 4px radius to create a strong call to action. Secondary buttons (`button-secondary`) invert to white with a light border and dark text, keeping the same sizing for parity. Link buttons (`button-link`) are minimal, with no background, no border, and no padding beyond the text itself.

Cards (`card`) use a light surface fill, a 1px border, and modest 8px rounding or close equivalents, with compact padding so they can hold dense content without feeling bulky. Inputs should follow the same restrained language: white background, subtle border, and small radius, prioritizing clarity over decoration. Chips and badges should be pill-shaped, lightly tinted, and compact, using blue text or accent fills to communicate status or category without overwhelming the layout. Navigation links and utility actions should remain visually quiet until active or primary.

## Do's and Don'ts
- Do use the primary blue for the most important action on a page.
- Do keep typography bold, clean, and highly legible with strong hierarchy.
- Do preserve generous outer whitespace around hero and section content.
- Do use light borders and tonal surfaces to separate cards instead of heavy shadows.
- Don't introduce large corner radii on primary controls.
- Don't add decorative gradients, glass effects, or ornate shadows.
- Don't overuse accent color in body copy or secondary UI.
- Don't compress layout spacing so much that the page loses its premium, open feel.