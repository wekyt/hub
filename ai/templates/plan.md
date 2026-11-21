# Plan: [PROJECT OR FEATURE NAME]

This plan turns the brief into ordered, executable work. It is written by the orchestrator after the brief is complete, and it is the document the architect and the dev agent build from. Change the plan only by editing this file, never by informal messages.

Source brief: [PATH TO brief.md]

## Goal

Restate the goal from the brief in one or two sentences. If the goal cannot be stated simply, the brief is not ready.

[GOAL HERE]

## Steps

Break the work into small steps. Each step must be completable by one agent in one pass, with a clear output.

| # | Step | Owner | Output | Depends on |
|---|------|-------|--------|------------|
| 1 | [STEP NAME] | [ORCHESTRATOR, ARCHITECT, DEV, QA, OR SECURITY] | [FILE, TEST, OR ARTIFACT PRODUCED] | [NONE, OR STEP NUMBER] |
| 2 | [STEP NAME] | [OWNER] | [OUTPUT] | [DEPENDENCY] |
| 3 | [STEP NAME] | [OWNER] | [OUTPUT] | [DEPENDENCY] |

Rules for steps:

- One step does one thing. If a step needs the word "and" to describe it, split it.
- Every step names its output. A step without an output cannot be verified.
- No step starts until its dependencies are done and verified.

## Dependencies

List external dependencies the plan relies on.

- [DEPENDENCY 1: LIBRARY, SERVICE, API, OR PRIOR WORK, WITH VERSION OR LINK]
- [DEPENDENCY 2]
- What happens if a dependency is unavailable: [FALLBACK OR STOP CONDITION]

## Risks

List what could go wrong, how likely it is, and what we do about it.

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| [RISK 1] | [LOW, MEDIUM, OR HIGH] | [LOW, MEDIUM, OR HIGH] | [WHAT WE DO BEFORE OR WHEN IT HAPPENS] |
| [RISK 2] | [LOW, MEDIUM, OR HIGH] | [LOW, MEDIUM, OR HIGH] | [MITIGATION] |

## Execution Order

State the order in plain words, including what runs in parallel and what runs in sequence.

1. [FIRST: WHAT HAPPENS, AND WHY IT COMES FIRST]
2. [SECOND: WHAT HAPPENS NEXT]
3. [PARALLEL WORK: WHAT CAN RUN AT THE SAME TIME, AND WHY IT IS SAFE TO DO SO]

## Verification

State how we know the plan is done.

- [CHECK 1: TIED TO A SUCCESS CRITERION FROM THE BRIEF]
- [CHECK 2]
- [CHECK 3]

## Open Questions

List questions that must be answered before or during execution. A question that blocks a step must name the step it blocks.

- [QUESTION 1: BLOCKS STEP N, OR "NON BLOCKING"]
- [QUESTION 2]
