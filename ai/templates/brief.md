# Brief: [PROJECT OR FEATURE NAME]

Fill this template before any planning starts. The brief is the single source of truth for what we are building and why. If a section does not apply, write "Not applicable" and say why. Never leave a section blank.

## Problem

Describe the problem in plain language.

- What is broken, missing, or too slow today?
- Who feels the pain, and how often?
- What happens if we do nothing?

[WRITE THE PROBLEM HERE. ONE PARAGRAPH, THEN UP TO THREE BULLETS WITH EVIDENCE.]

## User

Describe the person or system this work serves.

- Primary user: [WHO USES IT, IN ONE LINE]
- What they are trying to do: [THEIR GOAL, IN ONE LINE]
- What they are not: [WHO THIS IS NOT FOR]

## Scope

List exactly what this work includes. Each item must be verifiable when done.

- [IN-SCOPE ITEM 1]
- [IN-SCOPE ITEM 2]
- [IN-SCOPE ITEM 3]

## Files

List the exact paths the team may touch and the paths it must never touch. The dev builds only in the may-touch list; anything else needs a revised architecture first.

- May touch: [PATHS OR PATTERNS]
- Must never touch: [FOR EXAMPLE: .env, CREDENTIALS, PRIVATE KEYS, LOCKFILES UNLESS THE TASK IS ABOUT THEM, WORKFLOW FILES UNLESS THE TASK IS ABOUT THEM]

## Out of Scope

List what this work explicitly does not include. This list prevents scope creep and protects the QA gate.

- [OUT-OF-SCOPE ITEM 1]
- [OUT-OF-SCOPE ITEM 2]
- [OUT-OF-SCOPE ITEM 3]

## Success Criteria

List measurable criteria. Each criterion must be checkable without human judgment.

- [CRITERION 1: WHAT MUST BE TRUE, AND HOW TO CHECK IT]
- [CRITERION 2: WHAT MUST BE TRUE, AND HOW TO CHECK IT]
- [CRITERION 3: WHAT MUST BE TRUE, AND HOW TO CHECK IT]

## Constraints

List hard limits the team must respect.

- Budget or cost limit: [LIMIT, OR "NONE"]
- Deadline: [DATE, OR "NONE"]
- Technical limits: [FOR EXAMPLE: STACK, PLATFORM, COMPATIBILITY]
- Security or privacy limits: [FOR EXAMPLE: NO EXTERNAL CALLS, NO STORED SECRETS]
- Tool versions: pinned exact versions in every repeatable flow (npx <tool>@<version>), never @latest.

## References

- [LINK OR PATH TO THE REQUEST, ISSUE, OR PRIOR DISCUSSION]
- [LINK OR PATH TO RELEVANT DOCS, DESIGNS, OR DATA]
