# Skills

## What This Folder Is For

This folder holds skills: short Markdown playbooks the agent team loads by description when a task needs them. A skill is not code and not a framework. It is a written procedure: how to do one kind of work well, step by step, with the checks that matter.

The team loads a skill when the task matches its description. The orchestrator picks skills in the plan, and any agent may load a skill mid task when the work calls for it.

## How a Skill Works

- One skill, one file, one job. If a skill tries to cover two jobs, split it.
- The file starts with a short description of when to use it, then the procedure.
- Skills are plain Markdown. No build step, no install step, no runtime dependency.
- A skill never grants access on its own. Access comes from the tool store, with least privilege. A skill only says how to use the access the agent already has.

## How to Add a Skill

1. Create a new `.md` file in this folder. Name it after the job, in lowercase with hyphens, for example `review-pull-request.md`.
2. Start the file with a one line description: what the skill does, and when to use it.
3. Write the procedure as numbered steps. Each step must be actionable and checkable.
4. List the tools the skill needs, and the output it must produce.
5. List common mistakes and how to avoid them.
6. Add the skill to the list below, with its description.

## Skills in This Folder

| Skill | What it does |
|-------|-------------|
| [SKILL NAME] | [ONE LINE DESCRIPTION] |

## Shared Skills From the wekyt Org

The shared skills of the wekyt org live in separate repos, not in this folder. They are versioned, reviewed, and published there, and copied here when a project needs them.

To use a shared skill:

1. Find the skill in its org repo.
2. Copy the skill file into this folder.
3. Record the source repo and version in the list below, so the next update can be traced.

| Skill | Source repo | Version |
|-------|-------------|---------|
| [SKILL NAME] | [ORG REPO URL OR PATH] | [VERSION OR COMMIT] |
