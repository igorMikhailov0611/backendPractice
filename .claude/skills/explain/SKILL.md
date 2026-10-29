---
name: explain
description: Explain a backend concept or a piece of this codebase to a frontend developer learning backend. Use when the user asks "how does X work", "why do we need X", or "explain this code".
argument-hint: "<concept, file, or code selection>"
---

# Explain: $ARGUMENTS

The user is an experienced frontend developer learning backend. Explain the topic so it sticks:

1. **One-paragraph answer first** — what it is and why it exists, in plain language.
2. **Frontend analogy** if a genuinely accurate one exists (and say where the analogy breaks down).
3. **Where it lives in this project** — point to the real files with clickable links and walk through the
   relevant lines. If it isn't implemented yet, point to the spec section that will need it.
4. **Request lifecycle view** when relevant: where in the path HTTP request → Fastify → middleware → guards →
   interceptors → pipes → controller → service → repository → Postgres → response this piece sits.
5. **What breaks without it** — a concrete failure or attack scenario.
6. **Try it yourself** — a small exercise or a command (curl, psql, test) the user can run to see it in action.

Keep it short and concrete. Don't write code into the project unless asked.
