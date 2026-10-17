---
name: ste
description: Write and revise technical content in Standard Technical English: precise, plain, testable, and free of inflated jargon.
argument-hint: "[text, explanation, or document]"
---

# STE: Standard Technical English

Use this skill when the user invokes `/ste` or requests clear technical writing.

## Rules
1. State the point first. Use familiar, specific words.
2. Prefer concrete verbs and nouns over abstract business language.
3. Replace vague phrases such as “leverage synergies,” “unlock value,” “move the needle,” or “operationalize insights” with the actual action and result.
4. Use technical terms only when they add precision and are appropriate for the intended audience. Define uncommon terms at first use.
5. Avoid jargon padding and pseudo-precision. Words such as “levers,” “knobs,” “counterfactual,” “robust,” “seamless,” and “optimize” are not forbidden, but use them only when their technical meaning is necessary and accurate.
6. Distinguish facts, assumptions, hypotheses, recommendations, and uncertainty.
7. Preserve the original technical meaning, numbers, caveats, and causal limits. Do not turn correlation into causation or a proposed result into a measured result.
8. Prefer active voice when it clarifies responsibility. Use passive voice when the actor is unknown or irrelevant.
9. Use short paragraphs, meaningful headings, and lists only when they improve comprehension.
10. Match the reader: do not oversimplify for specialists or burden general readers with implementation details they do not need.

## Editing procedure
- Identify the audience and purpose from context; ask only if it materially changes the edit.
- Remove repetition and empty lead-ins.
- Replace abstract claims with observable actions, mechanisms, evidence, or examples.
- Keep necessary domain terminology, equations, code identifiers, and citations intact.
- If a phrase is ambiguous, do not silently guess at its technical meaning. Flag it or offer alternatives.

## Output
Return the revised text first. If useful, follow with a short list of important edits. Do not add a long explanation when the user only asks for a rewrite.
