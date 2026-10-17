# Agent Skills Pack

This bundle contains five original, Claude Code-style skill definitions:

- `/interview` — clarify requirements and save a project brief
- `/better-ui` — audit and polish an application UI
- `/animate` — add purposeful, accessible motion
- `/agentation` — turn visual annotations into traceable UI changes
- `/ste` — write clear Standard Technical English

## Install

Copy the five skill folders into your project's `.claude/skills/` directory, or into your personal Claude skills directory if you want them available across projects. Each skill folder must contain its `SKILL.md`.

Example project layout:

```text
your-project/
└── .claude/
    └── skills/
        ├── interview/SKILL.md
        ├── better-ui/SKILL.md
        ├── animate/SKILL.md
        ├── agentation/SKILL.md
        └── ste/SKILL.md
```

These are original implementations based on the functions described in the request, not copies of third-party skill source code. `/agentation` defines the workflow for handling annotations; it does not install or connect the separate Agentation tool.
