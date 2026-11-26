---
name: ship-pr
description: Ships the current branch's PR for an issue. Runs test, lint, tsc and build and stops on any failure, checks no .env files are staged, prints the push command, and after the user confirms the push marks the PR ready, requests review from Nakul-Shivaraj, writes the PR description (with an AI disclosure and an empty C.L.E.A.R. review section) and moves the issue to In review. Use when the user runs /ship-pr <issue-number>.
argument-hint: "[issue-number]"
disable-model-invocation: true
allowed-tools: Bash(npm run test) Bash(npm run lint) Bash(npx tsc --noEmit) Bash(npm run build) Bash(git status *) Bash(git diff *) Bash(git log *) Bash(git rev-parse *) Bash(git branch --show-current) Bash(gh issue view *) Bash(gh pr view *) Bash(gh pr list *) Bash(gh project field-list *) Bash(gh project item-list *) Bash(gh project view *)
---

# /ship-pr $ARGUMENTS

Ship the PR for issue #$0 in the StockSonar repo (dhanraj176/stocksonar), from the current branch. Do the steps in order and stop wherever a step says to.

## Rules
- Never push, never merge (`git push`, `gh pr merge`). The user pushes and merges.
- Never read `.env*` files: no Read, `cat`, `grep`, `source` or similar. The one exception is `.env.example`, the committed template of variable names. Checking file *names* (step 2) is fine.
- Don't change code to make a check pass. Report the failure and stop.
- Report results faithfully. If something was skipped or failed, say so.

## 1. Checks
- If `$0` isn't a number, ask for the issue number and stop.
- Run `git branch --show-current`. If it's `main`, stop.
- Run each of these, with output:
  - `npm run test`
  - `npm run lint`
  - `npx tsc --noEmit`
  - `npm run build`
- If any fails, stop. Show the failing command and the relevant output, and do nothing else.
- Record the test count from the test output (e.g. "345 tests in 23 files").

## 2. Nothing secret going out
- Run `git status --porcelain`. If there are uncommitted or untracked changes (ignored files don't count), list them and ask whether to continue. Don't commit them yourself.
- Staged `.env` files: run `git diff --cached --name-only`.
- `.env` files committed on the branch: run `git diff --name-only <base>...HEAD`, where `<base>` is the PR's base branch, or `origin/main` if there's no PR yet.
- If either lists a path matching `(^|/)\.env` other than `.env.example`, stop and tell the user. Only check names; never open those files.

## 3. Draft the description, then hand over the push
- Find the PR: `gh pr list --head <branch> --state open --json number,isDraft,baseRefName,url`.
- Read the issue (`gh issue view $0`), the branch's commits (`git log <base>..HEAD`), the diff stat and the plan in `docs/plans/`.
- Draft the description:
  - **## Summary**: what the PR adds and why, in a few bullets.
  - **## How to test**: the exact commands, plus any manual or live steps.
  - **Test count**: the number from step 1.
  - **## Known gaps**: what isn't done or isn't verified, honestly.
  - **## AI disclosure**:
    - Tool: Claude Code.
    - Model: the model this session runs on, with its exact ID.
    - Rough % of the diff AI-generated: estimate it from the commits with an AI Co-Authored-By trailer and from this session.
    - What was human-reviewed: propose this, for the user to confirm.
  - **## C.L.E.A.R. review**: a heading followed by `_To be completed by the reviewer._`, nothing more.
  - `Closes #$0`
  - Then the PR attribution line this session uses.
- Show the user:
  - the push command: `git push -u origin <branch>` (or `git push` if the branch already tracks a remote);
  - if no PR exists, also `gh pr create --draft --base <base> --head <branch> --title "<issue title>" --body "Closes #$0"`;
  - the AI disclosure numbers, asking them to confirm or correct the percentage and the human-reviewed list.
- **Stop and wait** until the user confirms that they pushed (and created the PR).

## 4. After the user confirms
- Run `git fetch origin <branch>`, then check that `git rev-parse HEAD` equals `git rev-parse origin/<branch>`. If they differ, say so and stop.
- Find the PR number again. Apply the user's corrections to the AI disclosure. Write the description to a temporary file outside the repo, then run `gh pr edit <pr> --body-file <file>`.
- Mark it ready: `gh pr ready <pr>`.
- Request review: `gh pr edit <pr> --add-reviewer Nakul-Shivaraj`.
- Move the issue to **In review** on the board (project 2, owner `dhanraj176`):
  1. Project id: `gh project view 2 --owner dhanraj176 --format json --jq .id`
  2. Status field and option ids: `gh project field-list 2 --owner dhanraj176 --format json --jq '.fields[] | select(.name=="Status")'`
  3. Item id: `gh project item-list 2 --owner dhanraj176 --format json --limit 500 --jq '.items[] | select(.content.number==$0) | .id'`
  4. Set it: `gh project item-edit --project-id <project> --id <item> --field-id <field> --single-select-option-id <in-review option>`
- Check the result with `gh pr view <pr> --json isDraft,reviewRequests,url` and by re-reading the board item.
- Report: the PR URL, ready (not draft), the reviewer requested, the issue's status, and the test count.
