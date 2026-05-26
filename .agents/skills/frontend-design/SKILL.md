---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, artifacts, posters, or applications (examples include websites, landing pages, dashboards, React components, HTML/CSS layouts, or when styling/beautifying any web UI). Generates creative, polished code and UI design that avoids generic AI aesthetics.
license: Complete terms in LICENSE.txt
---

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc. There are so many flavors to choose from. Use these for inspiration but design one that is true to the aesthetic direction.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work - the key is intentionality, not intensity.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Frontend Aesthetics Guidelines

Focus on:
- **Typography**: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics; unexpected, characterful font choices. Pair a distinctive display font with a refined body font.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & Visual Details**: Create atmosphere and depth rather than defaulting to solid colors. Add contextual effects and textures that match the overall aesthetic. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays.

NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial, system fonts), cliched color schemes (particularly purple gradients on white backgrounds), predictable layouts and component patterns, and cookie-cutter design that lacks context-specific character.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No design should be the same. Vary between light and dark themes, different fonts, different aesthetics. NEVER converge on common choices (Space Grotesk, for example) across generations.

**IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

## Console and Operations UI Refactor Lessons

Use these checks when improving dashboards, admin panels, setup flows, or operations consoles:

- **Start with information architecture, not paint**: List every repeated status, duplicated button, and competing navigation pattern before changing colors. Collapse duplicate status cards into one authoritative place.
- **Prefer capability-focused panels over long waterfalls**: For dense workspaces, use a primary capability switcher and render only the active task panel. Keep secondary/rare actions behind progressive disclosure.
- **Make navigation operational**: Step rails, flow chips, and matrix cards should be clickable and should select the same underlying state. Avoid visual-only navigation that duplicates a checklist elsewhere.
- **Separate similar but different jobs**: Split flows like “admin login QR” and “public user entry QR” into distinct panels, copy, and actions so users do not confuse internal setup with external sharing.
- **Free forms from narrow sidebars**: Inputs, scan results, pairing forms, and diagnostic lists need enough width to breathe. Sidebars are best for summaries, context, and compact tools.
- **Use truthful runtime copy**: If a service is paused, cooling down, retrying, or degraded, do not label it “running” just because a token exists. Make the state label match the operational truth.
- **Derive links from configured state**: Never ship stale hardcoded fallback URLs in production UI. Prefer `accessUrl`, then derive from `baseUrl`, otherwise show a disabled/empty state.
- **Extract repeated operational widgets**: If a status/assessment/control block appears in two views, make it a shared component before styling it. Shared logic prevents drift in labels, disabled states, and calculations.
- **Measure the layout in the browser**: Validate `scrollWidth`, column widths, panel heights, and active panel count at target viewport sizes. “No horizontal scroll” is necessary but not enough; avoid 300px main work columns.
- **Animate long-running actions centrally**: Restart, install, upgrade, scan, pair, and pressure-test actions should expose one busy state and one consistent loading overlay or in-card progress state.

Remember: Claude is capable of extraordinary creative work. Don't hold back, show what can truly be created when thinking outside the box and committing fully to a distinctive vision.
