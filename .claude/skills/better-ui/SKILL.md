---
name: better-ui
description: Audit an application's interface for usability, visual consistency, accessibility, responsive behavior, and implementation polish; then prioritize concrete improvements.
argument-hint: "[route, screen, or app area]"
---

# Better UI: application interface audit

Use this skill when the user invokes `/better-ui`, asks for a UI audit, or wants an existing interface polished.

## Workflow
1. Inspect the app structure, design system, package scripts, and relevant routes/components before proposing changes.
2. Run the app or existing checks when the environment supports it. Inspect key screens at available viewport sizes; do not claim visual verification if you could not run the app.
3. Audit:
   - Information hierarchy and clarity of primary actions
   - Layout, alignment, spacing, typography, and readable line lengths
   - Color contrast, focus states, keyboard access, labels, and semantic structure
   - Responsive layouts, overflow, and touch-target sizes
   - Loading, empty, success, error, and disabled states
   - Forms, validation, navigation, and feedback
   - Consistent tokens/components and avoidance of unnecessary duplication
   - Performance and motion preferences where relevant
4. Separate findings into severity: P0 (blocks use), P1 (major friction), P2 (noticeable polish), P3 (optional refinement). Tie each finding to a specific screen/component and user impact.
5. Prefer a small number of coherent improvements over a wholesale redesign. Preserve the product's intent, brand, existing architecture, and working behavior.
6. Implement improvements when asked to fix the UI; otherwise provide a prioritized audit with specific examples. Add or update tests where practical.
7. Verify changed screens and relevant tests/build after edits. Report what was checked and any verification limitations.

## Design principles
- Make the next useful action obvious.
- Use consistent spacing and type scales instead of arbitrary one-off values.
- Use meaningful visual hierarchy, not decoration for its own sake.
- Avoid generic “AI dashboard” styling, excessive gradients, gratuitous glass effects, unnecessary cards, and animation without purpose.
- Use motion sparingly and respect `prefers-reduced-motion`.
- Keep text direct, accessible, and appropriate to the product's audience.

## Output
For an audit, give a concise prioritized list with: location, issue, user impact, recommended change, and effort (S/M/L). For implementation, summarize changes and verification.
