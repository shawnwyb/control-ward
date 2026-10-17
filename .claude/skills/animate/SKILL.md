---
name: animate
description: Design and implement purposeful, accessible UI motion using timing, easing, sequencing, and reduced-motion best practices.
argument-hint: "[component or interaction]"
---

# Animate: purposeful motion design

Use this skill when the user invokes `/animate` or requests animation or motion polish in an interface.

## Workflow
1. Inspect the framework, animation libraries already installed, component patterns, and target interaction. Prefer the project's existing tools; do not add a dependency unless it provides clear value.
2. Define the purpose of each animation: communicate state change, preserve spatial context, guide attention, provide feedback, or add restrained delight.
3. Apply motion only where it helps. Prefer transform and opacity for smooth performance; avoid animating layout-heavy properties when a composited alternative works.
4. Use consistent timing and easing. As a starting point, use short durations for micro-interactions (roughly 120–220 ms), moderate durations for transitions (roughly 180–320 ms), and longer motion only when the content warrants it. Adjust to context rather than applying these mechanically.
5. Ensure animation does not delay task completion, obscure content, or make the interface feel sluggish. Avoid looping motion unless it communicates ongoing activity.
6. Respect `prefers-reduced-motion`; provide a reduced or static alternative. Keep keyboard, focus, and screen-reader behavior correct regardless of animation.
7. Test the interaction in its relevant states and viewport sizes. Check for layout shifts, clipping, jank, and conflicting transitions.

## Motion patterns
- Entrance/exit: subtle opacity and small positional changes; avoid large theatrical movement.
- Hover/press: restrained feedback that does not carry meaning exclusively through motion.
- State changes: animate the relevant element so cause and effect remain clear.
- Lists and page transitions: sequence only when it improves comprehension; avoid delaying access to content.
- Loading: use a clear status and avoid distracting indefinite effects.

## Output
Implement the requested motion when asked to edit code. Briefly explain which interactions changed, why the motion helps, how reduced motion is handled, and what was tested. Never claim to have rendered or tested an animation unless you did.
