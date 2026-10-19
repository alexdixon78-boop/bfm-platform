# Project Working Rules

## 1. Git Safety

NEVER:
- run `git add`
- run `git commit`
- run `git push`
- stage files
- amend commits
- reset/revert/discard my changes

You MAY use read-only Git commands:
- `git status`
- `git diff`
- `git log`
- `git branch`

Only perform Git write operations when I explicitly request them in my current message.

---

## 2. Replit Documentation

- Read `replit.md` before starting work if it exists.
- Use it as a project reference.
- Keep it updated when implementation changes affect documented project behavior.
- Update it when there are meaningful changes to:
  - architecture
  - APIs
  - database/schema
  - integrations
  - configuration
  - deployment
  - business logic
  - project conventions
  - implementation status
- Preserve useful existing information.
- Do not rewrite the file unnecessarily.
- Do not update it for trivial changes.
- After updating `replit.md`, leave the changes unstaged.
- Never commit or push the documentation changes.

---

## 3. Task Completion

After completing a task:
1. Verify the implementation.
2. Check whether `replit.md` needs updating.
3. Update it if necessary.
4. Leave all changes unstaged.
5. Do not commit or push.
6. Report the files changed and what was done.


## 4. Note
1. DB URL in the AWS secret manager keys are in the env. can only be use for ready only and testing.