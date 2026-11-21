# wekyt Hub Kit

## What Is the `ai/` Folder

The `ai/` folder is the kit that turns a plain repository into a project an agent team can build, maintain, and support on its own. It lives at the root of the project, next to the code, and it holds everything the team needs: who the agents are, how they work together, what they may use, and the templates they build from.

The kit is lightweight by design: plain `.md` files, no framework, no build step, no runtime dependency. Any project can adopt it by copying this folder.

## Standard Layout

```
ai/
  CONTEXT.md          Shared map of the repo, kept current by the orchestrator
  README.md           This file
  agents/             One file per agent: role, duties, limits
  skills/             Markdown playbooks the team loads by description
  tools/              Tool store: what tools exist, who may use them, with least privilege
  templates/          Templates for the mandatory flow: brief, plan, architecture
```

## The Default Team: 5 Agents

The default install is the dev team only. No other team is installed unless the project asks for it.

| Agent | Role |
|-------|------|
| Orchestrator | Owns the brief, the plan, and the run. Breaks work down, assigns it, and keeps `CONTEXT.md` current. |
| Architect | Owns the architecture document. Maps the system, records decisions with rejected alternatives, and defines contracts between parts. |
| Dev | Builds from the plan and the architecture. Writes code and tests, nothing more, nothing less. |
| QA | Verifies the build against the brief, the plan, and the architecture, with objective tests. QA never approves its own work. |
| Security | Reviews every change for security and privacy risks. Security can block a merge, and its block must be resolved, not overridden. |

Each agent has one file in `agents/`. That file states its role, its duties, its limits, and what it must never do.

## The Mandatory Flow

Every piece of work follows the same five stages, in order. No stage is skipped.

1. Brief. The orchestrator writes the brief from `templates/brief.md`: problem, user, scope, out of scope, success criteria.
2. Plan. The orchestrator writes the plan from `templates/plan.md`: steps, dependencies, risks, execution order.
3. Architecture. The architect writes the architecture from `templates/architecture.md`: system map, components, decisions, contracts.
4. Build. The dev agent builds from the plan and the architecture, with tests.
5. QA. The QA agent verifies the build with objective tests, and the security agent reviews it. Only then can the work merge.

## The Tool Store

The `tools/` folder is the cross cutting tool store: the registry of every tool the team may use, with who may use each one and with what limits. Tools are granted with least privilege: an agent gets only the access its role needs, nothing more. A skill never grants access on its own. The tool store is the only source of access.

## The Merge Gate

Zero human in the loop. No human reviews, approves, or merges. The merge happens only when all layers agree:

- The dev agent finished the build and its tests pass.
- The QA agent verified the build against the brief, the plan, and the architecture.
- The security agent reviewed the change and raised no blocking issue.
- Every check is recorded in the audit trail.

If any layer disagrees, the work does not merge. It goes back to the dev agent with the exact failure. Rollback is automatic: a failed merge or a failed check after merge returns the project to the last known good state. Every decision, every check, and every merge is recorded in a complete audit trail.

## How to Start the First Job

1. Copy the `ai/` folder to the root of your project.
2. Run the installer with one command and zero questions. It installs the default dev team only.
3. Give the orchestrator the first brief: what to build, for whom, and what success looks like. Use `templates/brief.md`.
4. The orchestrator fills in `CONTEXT.md` from the project tree, the README, and the project manifest, then runs the mandatory flow: brief, plan, architecture, build, QA.
5. The work merges only when all layers agree. Watch the audit trail, not a human inbox.

## How to Update the Kit

The kit updates itself through the same flow as any other work: brief, plan, architecture, build, QA, with the same merge gate.

- Small fixes go through the normal flow, with the kit itself as the project.
- When a shared skill changes in its org repo, copy the new version into `ai/skills/` and record the source and version in `ai/skills/README.md`.
- When the team changes, update the agent files in `ai/agents/` and this README in the same change, so the map and the team never drift apart.
- Never edit the kit by hand outside the flow. A hand edit with no audit trail is a change nobody can verify.
