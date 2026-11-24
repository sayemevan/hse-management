# 06 — Prompts

AI working prompts for this project. Each prompt lives in `docs/prompts/` and is listed here.

| #   | Prompt                                                             | Purpose                                                        |
| --- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| 00  | [Bootstrap — Master Prompt](prompts/00_BOOTSTRAP_MASTER_PROMPT.md) | Doc reorganisation, planning and project foundation (Sprint 0) |
| 01  | [Sprint Workflow](prompts/01_SPRINT_WORKFLOW.md)                   | Map, conventions and steps used by the sprint commands below   |

## Sprint commands

Type these in Claude Code; each one reads Prompt 01 and runs one stage.

| Command            | Stage                                                               |
| ------------------ | ------------------------------------------------------------------- |
| `/sprint-spec 7`   | Write Sprint 7 specs as Draft and ask for approval                  |
| `/sprint-build 7`  | Record approval and implement (add changes after the number if any) |
| `/sprint-accept 7` | Record acceptance and mark the sprint done                          |

The command files live in `.claude/commands/`. Keep the "Next IDs" line in Prompt 01 current.

## TODO

- [x] Per-sprint implementation prompt template (Prompt 01 and the sprint commands)
- [ ] User-story implementation prompt template (based on Doc 15)
- [ ] Code-review prompt
