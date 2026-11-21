# Architecture: [PROJECT OR FEATURE NAME]

This document maps the system before code is written. The architect owns it. The dev agent builds from it, and QA checks the build against it. If the build drifts from this document, update the document first, then the code.

Source brief: [PATH TO brief.md]
Source plan: [PATH TO plan.md]

## System Map

Describe the system at a glance: what it is, what it talks to, and where its boundaries are.

[ONE PARAGRAPH OVERVIEW. THEN A SIMPLE MAP, FOR EXAMPLE: CLIENT, API, DATABASE, EXTERNAL SERVICE, WITH ARROWS SHOWING DATA FLOW.]

## Components

List each component, its responsibility, and its inputs and outputs. One component does one job.

| Component | Responsibility | Inputs | Outputs |
|-----------|---------------|--------|---------|
| [NAME] | [WHAT IT DOES, IN ONE LINE] | [WHAT IT RECEIVES, AND FROM WHERE] | [WHAT IT PRODUCES, AND FOR WHOM] |
| [NAME] | [RESPONSIBILITY] | [INPUTS] | [OUTPUTS] |

For each component, add a short note on:

- Where its code lives: [PATH]
- What it must never do: [FOR EXAMPLE: NEVER CALL THE DATABASE DIRECTLY, NEVER STORE SECRETS]

## Data Flow

Trace one representative request or job from start to finish.

1. [STEP 1: WHO STARTS IT, AND WHAT DATA MOVES]
2. [STEP 2: WHAT EACH COMPONENT DOES WITH THE DATA]
3. [STEP 3: WHERE THE DATA ENDS UP, AND WHAT IS RETURNED]

## Decisions

Record each important decision with its context, the options considered, and why the chosen option won. Rejected alternatives are as important as the choice: they stop the team from re-litigating the same question later.

### Decision 1: [TITLE]

- Context: [WHAT FORCED THIS DECISION]
- Decision: [WHAT WE CHOSE]
- Alternatives rejected:
  - [ALTERNATIVE A: WHY IT WAS REJECTED]
  - [ALTERNATIVE B: WHY IT WAS REJECTED]
- Consequences: [WHAT THIS CHOICE COSTS US, AND WHAT IT BUYS US]

### Decision 2: [TITLE]

- Context: [CONTEXT]
- Decision: [DECISION]
- Alternatives rejected:
  - [ALTERNATIVE A: WHY IT WAS REJECTED]
- Consequences: [CONSEQUENCES]

## Contracts Between Parts

Define how components talk to each other. A contract is a promise: if a component breaks it, the system breaks.

| From | To | Contract |
|------|----|----------|
| [COMPONENT A] | [COMPONENT B] | [FORMAT, FIELDS, ERROR BEHAVIOR, AND VERSIONING RULE] |
| [COMPONENT A] | [COMPONENT B] | [CONTRACT] |

Contract rules:

- Every contract names its data format and required fields.
- Every contract names its error behavior: what happens on failure, timeout, or bad input.
- Contracts change only with a version bump and an update to this document.

## Security Notes

List the security properties of this design.

- Authentication: [HOW EACH PART PROVES WHO IT IS]
- Authorization: [WHO MAY DO WHAT, AND WHERE IT IS ENFORCED]
- Secrets: [WHERE SECRETS LIVE, AND THAT THEY NEVER APPEAR IN CODE, LOGS, OR THIS DOCUMENT]
- Data protection: [WHAT SENSITIVE DATA EXISTS, AND HOW IT IS PROTECTED]

## Failure Modes

List how the system fails, and what happens in each case.

| Failure | Behavior | Recovery |
|---------|----------|----------|
| [FAILURE 1: FOR EXAMPLE, DATABASE DOWN] | [WHAT THE USER SEES, WHAT IS LOGGED] | [AUTOMATIC ROLLBACK, RETRY, OR MANUAL STEP] |
| [FAILURE 2] | [BEHAVIOR] | [RECOVERY] |

## Open Questions

- [QUESTION 1: WHAT IS STILL UNDECIDED, AND WHO DECIDES IT]
- [QUESTION 2]
