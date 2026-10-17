---
name: interview
description: Clarify an ambiguous project request through focused questions, then write an agreed project brief before implementation.
argument-hint: "[project or task]"
---

# Interview: align before building

Use this skill when the user invokes `/interview` or asks to clarify a project before execution.

## Goal
Turn an underspecified request into an explicit, agreed-upon brief. Do not start implementation while material decisions remain unresolved.

## Process
1. Read the current request and available project files first. Do not ask for facts already supplied.
2. Identify uncertainties that could materially change the solution: users, desired outcome, scope, constraints, platform, existing architecture, design direction, data, integrations, security/privacy, accessibility, performance, and success criteria.
3. Ask concise questions in small batches. Prioritize the highest-impact unknowns. Prefer concrete choices when helpful, but allow free-form answers. Explain why a question matters only when that is not obvious.
4. Continue until the goal, scope, constraints, and acceptance criteria are clear enough to implement. Do not interrogate the user about minor details; use sensible defaults and label them as assumptions.
5. Summarize the agreement and explicitly call out assumptions, exclusions, dependencies, risks, and unresolved questions.
6. Save the brief in the repository as `docs/PROJECT_BRIEF.md` (create `docs/` if needed). If the repository uses a different established planning location, follow that convention instead. Do not overwrite valuable existing content without preserving it.
7. Ask the user to confirm the brief before substantial implementation. If they request implementation immediately, proceed only on clearly stated assumptions and record them.

## Required brief sections
- Problem and intended outcome
- Target users and main use cases
- In scope / out of scope
- Functional requirements
- UX and accessibility requirements, if relevant
- Technical constraints and integrations
- Data, privacy, and security considerations, if relevant
- Acceptance criteria / definition of done
- Assumptions, dependencies, and risks
- Open questions

## Guardrails
- Never claim agreement where the user has not agreed.
- Keep the brief actionable and concise.
- Treat the brief as the source of truth during later work. If a new request conflicts with it, flag the conflict and ask whether the brief should change.
