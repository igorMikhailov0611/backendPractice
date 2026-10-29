---
name: implement-spec
description: Implement one feature from docs/technical_specification.md in small, explained, verified steps. Use when the user asks to build an endpoint, flow, entity or module described in the spec (e.g. "implement registration", "add the RBAC tables").
argument-hint: "<feature or spec section, e.g. 'POST /auth/register'>"
---

# Implement a spec feature: $ARGUMENTS

1. **Read the spec.** Open `docs/technical_specification.md`, find every section that touches this feature
   (including the cross-cutting rules in §1: security pipeline, error codes, threat mitigations). Quote the
   exact requirements you are implementing.
2. **Check what exists.** Look at `src/modules/`, `src/core/` and existing entities/migrations so you reuse
   rather than duplicate. Note any prerequisites that are missing (e.g. users table before auth, config keys,
   a "Known gaps" item from CLAUDE.md that blocks this).
3. **Propose a plan** to the user before coding: the list of files to create/change, new config keys, new
   tables/migrations, new dependencies (with one-line justification each), and the order of steps.
   Include a short explanation of the backend concepts involved. Wait for confirmation if the plan adds
   dependencies or changes the schema.
4. **Implement step by step.** One logical unit per step (entity + migration, then DTOs, then service, then
   controller/guard). After each step: `npm run build`, run the related tests, and tell the user how to try it
   (curl command against `http://localhost:$PORT`, SQL to inspect the table, etc.).
5. **Tests.** Add unit tests for service logic, covering the spec's error cases and status codes, not just the
   happy path.
6. **Wrap up.** Summarise what was built, which spec requirements are now satisfied, what is intentionally
   left for later, and any new env vars to add to `.env`.
