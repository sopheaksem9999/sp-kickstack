# AI QA in In Review (before the merge), and the model by size and risk: design

Status: design approved by the user in chat, section by section, on 2026-10-13; revised the same day to move the automatic run from QA to In Review. This is an addendum to
`2026-10-13-ai-qa-agent-design.md` (AI QA phase 1, built in `a1171f5..5dc0a73`). That spec listed "QA before
the merge (in review)" as out of scope; this design brings it in. Everything not named here stays as phase 1
built it.

## Problem

AI QA runs only once a requirement is in **QA**, after its branches are merged into the target/base branch.
A problem it finds has then already landed on develop. When a requirement is **In Review**, the agents have
finished, review comments and **Request changes** already work, and nothing is merged yet. A problem caught
there is fixed on the task branch and never reaches develop.

## Decisions (user, 2026-10-13)

- **What is checked in In Review:** a **merge preview**. For each repository, the repository's unmerged task
  branches are merged into its target/base branch in a temporary checkout. This is the result **Merge & move
  to QA** would produce, and it is checked without moving any branch.
  - Rejected: checking each task branch on its own. It misses problems that appear only once the branches
    are combined with the latest base.
- **When:** AI QA **moves to In Review**. Its automatic run happens when a requirement enters In Review
  (Settings → AI QA → **Run automatically**, on by default), and never in QA.
  - **Run AI QA** is available in In Review (it checks the merge preview) and stays in QA as a **manual**
    option. In QA it re-checks the real merged code, for example when develop moved after the preview.
  - Rejected: a three-way Settings choice (In Review / QA / Never); one place is simpler. Also rejected:
    removing AI QA from QA entirely, which would leave no way to check the actual merge result.
  - In In Review the work is finished but not merged, so a finding is fixed on the task branch before it
    reaches develop. QA becomes the stage where people check the merged app.
- **Merge:** the merge warns but does not block; the person decides. Any way of moving the requirement to QA
  from the web asks for confirmation first, when In Review AI QA is running or found open blockers:
  - the **Merge & move to QA** buttons;
  - the **State** select;
  - dragging the card to QA on the board.

  The **auto-merge** policy waits for In Review AI QA and merges only when it left no open blocker.
  Otherwise the requirement stays In Review for a person.
- **Approach A:** `QaService` builds the preview commit before the run. The QA task stores that commit, and
  the run itself is the phase 1 run, unchanged.
  - Rejected: the runner merging at start. Conflicts would appear late, and the prompt could not list the
    changed files.
  - Rejected: reusing the merge gate's prepare phase. Tests would run twice, and it would be tied to the
    merge locks and merge state.

## What the person sees

- **Settings → AI & Local Engines → AI QA → Run automatically when a requirement enters In Review**
  (on by default). It is the phase 1 switch with a new moment: it used to start AI QA on entering QA. A
  saved value keeps its on/off meaning.
- **Requirement header.** It shows in **In Review** and in **QA**: the AI QA status line, the popover with
  each repository's run and its **Log**, and **Run AI QA**.
  - In a review round the line starts `AI QA before merge`, for example `AI QA before merge: 2 findings
    (1 blocker)`, `AI QA before merge: passed`, or `AI QA before merge failed: <reason>`.
  - The popover title is `AI QA · round N · merge preview into <branch>`.
  - QA rounds keep the phase 1 wording.
  - While auto-merge is held, a note under the line says why: `Auto-merge paused: AI QA is still checking`,
    or `Auto-merge paused: N open AI QA blocker(s)`.
- **Run AI QA.** In In Review it checks the merge preview. In QA it works as in phase 1 (the tip of the
  branch the requirement merged into). It is disabled while AI QA runs, and while a merge runs.
- **Findings.** They are open AI QA review comments on the repository's card, as in phase 1.
  - **Request changes** sends them back as usual. The requirement goes back to In Progress, and its review
    round stops.
  - When the agents finish again, the requirement re-enters In Review, and (with **Run automatically** on)
    a new automatic round starts.
- **Moving to QA.** If a review round is running, the question is "AI QA is still checking this requirement.
  Merge anyway?". If open blocker findings from review rounds remain, it is "N open AI QA blocker(s). Merge
  anyway?".
  - **Merge anyway** merges as today, and the review round stops.
  - **Cancel** does nothing; a dragged card goes back to its column.
  - There is no automatic run after the merge. In QA, **Run AI QA** is a manual re-check of the merged
    code; the header there shows the latest round (usually the one from In Review).

## Data

- A new migration (the next free number: **12**, since phase 1 took 11) adds `bridge_tasks.qa_stage TEXT`,
  which is `'review'` or `'qa'`. Existing QA tasks are set to `'qa'`.
  - The AI Chat MCP plan then takes the number after this one.
- `AiQaSettings.runAutomatically` keeps its name, type and default (`true`); only its moment changes (entering
  In Review instead of QA). Its doc comment and the Settings label say so. No settings migration is needed.
- Shared `BridgeTask` gains `qa_stage?: 'review' | 'qa' | null`.
- `RequirementQa` gains:
  - `stage: 'review' | 'qa' | null`, the latest round's stage (null when AI QA never ran);
  - `previewInto: string | null`, the branch a review round merged into, per the latest round;
  - `openBlockers: number`, the open (unsent, unresolved) AI QA blocker findings from review rounds of
    the requirement;
  - `autoMergeHold: string | null`.

## Server

**Merge preview** (new `services/mergePreview.ts`):

- `buildMergePreview(repo, base, tasks, opts)` works in a temporary folder under the OS temp dir:
  1. It adds a detached worktree at the tip of `base` (`refs/heads/<base>`, else `refs/remotes/origin/<base>`).
  2. For each task whose branch tip is ahead of the checkout, it runs `git merge --no-ff` in the merge
     gate's order, with the merge gate's message `Merge <REQ> task-<id>: <title>`.
  3. It records `HEAD` and removes the worktree and the folder.
- It returns `{ ok: true, sha, from }`, where `from` is the base tip. On failure it returns
  `{ ok: false, error }`, for example:
  - `<project>: merging <branch> into <base> conflicts in a.ts, b.ts (Merge & move to QA would conflict too)`;
  - `<project>: branch <branch> (task #<id>) does not exist`;
  - `<project>: base branch <base> was not found`.
- No branch or ref is created or moved. The preview commit is unreferenced; git keeps unreferenced objects
  for two weeks, far longer than any QA run.
- The query "unmerged branched goal/ticket tasks of a requirement, per repository, dependencies first" moves
  out of `MergeGateService` (`pendingByProject`) into a shared function. The merge gate and the preview both
  use it.

**QaService:**

- `start(reqId, trigger, commits?)` becomes `async`.
  - It is allowed when the requirement is `in_review` (stage `review`) or `qa` (stage `qa`). Otherwise it
    answers 409 `<REQ> is <status>; AI QA runs while a requirement is in review or in QA`.
  - It is refused with 409 `A merge of <REQ> is running; wait for it to finish` while `merge_state` is
    `running`.
  - It stores `qa_stage` on every QA task of the round.
- **Stage review, per git repository:**
  - with unmerged branched work: the QA task's commit (`base_sha`) is the preview `sha`. The prompt's changed
    files are `diffSummary(repo, from, sha)` and the range is `from..sha`. A failed preview fails that
    repository's QA task with the preview's error, and the other repositories still run;
  - with no unmerged work: it checks the target/base tip, as in phase 1.
- **Stage qa:** unchanged from phase 1.
- `onEnteredReview(reqId)` (new) starts a review round when `runAutomatically` is on. It never throws.
- AI QA no longer starts on entering QA: `QaService.onEnteredQa`, `MergeGateOptions.onEnteredQa` and their
  wiring in `index.ts` / `app.ts` are removed (the merge gate's test for them is replaced by the hold test
  below). A QA round only starts from **Run AI QA** in QA, where the commit is the phase 1 one (the tip of the
  branch the requirement merged into).
- `addFinding` and `recordResult` accept reports while the requirement's status matches the QA task's
  stage (`review` ↔ `in_review`, `qa` ↔ `qa`). Otherwise they answer 409:
  - `<REQ> is no longer in review; this finding was not saved` (or `… this result was not saved`);
  - the phase 1 wording for QA rounds.
- `autoMergeHold(reqId): string | null`:
  - `AI QA is still checking` while a review round has active QA tasks;
  - `N open AI QA blocker(s)` while open blocker findings from review rounds remain;
  - otherwise null.
- `status(reqId)` fills in `stage`, `previewInto`, `openBlockers` and `autoMergeHold`.

**QA prompt.** `buildQaPrompt` gets `stage` and `previewInto`. For review rounds, the opening says the
working directory is "a temporary merge of the requirement's branches into `<branch>`, not merged yet";
everything else is the same.

**Runner.** The sweep that stops QA runs whose requirement left QA (`stopQaOutsideQa`) now checks each run
against its task's stage:
- a review run stops when the requirement is no longer `in_review` (merged to QA, sent back, done or
  cancelled);
- a qa run stops when the requirement is no longer `qa`;
- the log line names the stage: `■ <REQ> is no longer in review; AI QA stops`.

A new option, `AgentRunnerOptions.onQaFinished?: (reqId: string) => void`, is called once when a QA task
reaches `done`, `failed` or `cancelled`.

**Merge gate and wiring:**
- `MergeGateOptions.autoMergeHold?: (reqId) => string | null`. `autoStart` returns without merging while it
  returns a reason.
- `index.ts` / `app.ts` wire it up as follows:
  - the task reactor's `onRequirementInReview` calls `qaService.onEnteredReview(id)`, then
    `mergeGate.autoStart(id)`;
  - `autoMergeHold` is `qaService.autoMergeHold`;
  - the runner's `onQaFinished` is `(reqId) => mergeGate.autoStart(reqId)`, which re-checks the policy, the
    requirement status and the hold;
  - `POST /api/requirements/:id/qa` awaits `start`.
- The merge itself is not blocked on the server; the question is asked in the web app.

## Web

- `AiQaHeader` shows when the requirement is `in_review` or `qa`. The status helpers take the stage into
  account (`AI QA before merge…` for review rounds), and the auto-merge pause note comes from
  `autoMergeHold`.
- A helper `mergeWarning(qa: RequirementQa | undefined): string | null` returns:
  - the running question when the latest round is a running review round;
  - else the blocker question when `openBlockers > 0`;
  - else null.
- One Radix confirm dialog, `MergeAiQaConfirm`, is used before every move to QA that would merge:
  - the **Merge & move to QA** buttons (side panel and full page);
  - the **State** select set to QA (side panel and full page);
  - dropping the card on the QA column on the board (`RequirementsPage`).

  On a board drop, **Cancel** returns the card. The requirement's QA status is fetched when needed.
- The Settings card's switch is relabelled **Run automatically when a requirement enters In Review**, with
  the helper text "Before the merge, on a merge preview. In QA, Run AI QA re-checks the merged code by hand".
- The Review comments, the badges and the Projects fields are unchanged.

## Errors

| Situation | Behaviour |
|---|---|
| Run AI QA outside In Review / QA | 409 `<REQ> is <status>; AI QA runs while a requirement is in review or in QA` |
| Run AI QA while a merge runs | 409 `A merge of <REQ> is running; wait for it to finish` |
| Run AI QA while AI QA runs | 409 `AI QA is already running for <REQ>` (phase 1) |
| Preview conflict | That repository's QA task fails with the conflict and its files; the other repositories run |
| A task branch or the base branch is missing | That repository's QA task fails with the reason |
| The requirement leaves the stage (merge, Request changes, Done, Cancel) | Its runs of that stage stop; late findings get 409 |
| Auto-merge while a review round runs or open blockers remain | The merge waits; the header shows the reason; a person merges (with the question) or sends changes back |

## Testing

- **Merge preview:**
  - it merges two branches into the base without moving any branch or creating refs;
  - a conflict reports its files;
  - a missing branch is reported;
  - with nothing to merge it returns the base tip;
  - the temporary folder is removed in every case.
- **QaService:**
  - start in review: stage, preview commit, changed files and range, prompt wording;
  - the refusals: other statuses, a running merge;
  - a conflict fails only that repository;
  - `onEnteredReview` follows `runAutomatically`; entering QA starts nothing;
  - findings and results follow the stage;
  - the `autoMergeHold` reasons;
  - the `status` fields.
- **Runner:**
  - a review run stops when the requirement moves to QA, and when it goes back to In Progress;
  - `onQaFinished` is called once per QA task.
- **Merge gate:**
  - `autoStart` waits while held;
  - with the auto-merge policy, a clean review round leads to the merge.
- **Web:**
  - `mergeWarning` and the review-stage header helpers;
  - the dialog, the board and the settings card through typecheck and build.

## Docs

- `06-review-qa-and-merge.md`: AI QA in In Review (the merge preview, the question before the merge,
  auto-merge waiting); AI QA's automatic run moves from QA to In Review; Run AI QA in QA is manual.
- `09-settings-and-environment.md`: **Run automatically** now means entering In Review.
- `10-troubleshooting.md`: the new messages (the preview conflict, "no longer in review", "AI QA runs while
  a requirement is in review or in QA", the auto-merge pause).

## Model by size and risk (added 2026-10-13)

The user wants AI QA to choose a model that fits each review and to save tokens. Of the options discussed,
they chose **model and effort by the size and risk of the change**. Skipping unchanged repositories and
incremental re-checks were not chosen (see Out of scope). This applies to AI QA runs only. The agents'
coding runs keep their current model choice (requirement / task / workspace profile, then Settings).

**Settings** (Settings → AI & Local Engines → AI QA → **Model**):

- **Auto (by size and risk)** is the default. **Fixed** is phase 1's single model and effort, still stored
  as `model` / `effort`.
- `AiQaSettings` gains:
  - `modelMode: 'auto' | 'fixed'` (default `'auto'`);
  - `tiers: Record<AgentCliId, { light: Profile; standard: Profile; deep: Profile }>`, where `Profile = { model:
    string | null; effort: ReasoningEffort | null }` and a null model means the CLI's default model;
  - `lightMaxLines` (default 150) and `deepMinLines` (default 1000).

  A stored phase 1 value has none of these and gets the defaults.
- Default tiers:

  | CLI | Light | Standard | Deep |
  |---|---|---|---|
  | Claude Code | haiku · low | sonnet · medium | opus · high |
  | Codex | CLI default · low | CLI default · medium | CLI default · high |
  | AGY | CLI default · low | CLI default · medium | CLI default · high |

- The card shows the tier table for the CLI that AI QA uses: the CLI chosen on the card, else the Local AI
  CLI engine's. Each tier's model and effort, and the two line limits, are editable. The models use the same
  validation as elsewhere (`AgentModelSchema`).

**Choosing the tier** (new `services/qaTier.ts`, pure functions):

- `classifyQaTier(files, riskPatterns, limits): { tier: 'light' | 'standard' | 'deep'; reason: string }`.
  `files` is the change the QA prompt lists, each with its added and deleted lines (the preview diff in In
  Review, the merged / branch diff in QA). Changed lines are additions plus deletions; binary files count
  as files only. The rules, in order:
  - **Deep** when a file matches a risky pattern (reason `touches <first matching path>`), or changed lines
    ≥ `deepMinLines`, or files ≥ 40 (reason `<n> lines in <m> files`).
  - **Light** when changed lines ≤ `lightMaxLines` and files ≤ 8.
  - **Standard** otherwise.
  - With no changed files listed, the tier is Standard (reason `no change list`).
- **Risky patterns** are the project's `high_risk_paths` plus these built-in patterns:
  `**/migrations/**`, `**/auth/**`, `**/security/**`, `**/payment*/**`, `**/billing/**`,
  `.github/workflows/**`, `.gitlab-ci.yml`, `**/Dockerfile`, `**/docker-compose*.yml`, `**/.env*`,
  `**/*secret*`.
  - Patterns are globs: `**` is any number of folders, `*` is any characters within one path segment.
    A pattern ending in `/` matches everything under that folder. Matching is case-insensitive and
    implemented in `qaTier.ts`; no new dependency.
- `qaProfileFor(settings, cli, tier): { model; effort }` returns the tier's profile for that CLI in Auto
  mode, and `settings.model` / `settings.effort` in Fixed mode.

**QaService.** For each repository, `start` classifies the change. It creates the run with the tier's model and
effort, and stores `qa_tier` and `qa_tier_reason` on the QA task (two more columns in the same migration 12).
Its log line names the choice, for example
`AI QA queued (Run AI QA) for abc1234 · light: 42 lines in 3 files → haiku · low`. In Fixed mode
`qa_tier` is null.

**Projects form.** A new optional field, **High-risk paths**: one pattern per line, stored in the existing
`high_risk_paths` field. Its helper text says "AI QA uses its strongest model when a change touches these
paths". The project details show it when set.

**Header.** The popover line for each repository shows the tier and why, for example
`backend · light · 42 lines in 3 files`. `QaRunView` gains `tier` and `tierReason`.

**Testing:**
- `classifyQaTier`: each rule, the limits from settings, a project pattern and a built-in pattern, a
  folder prefix, case-insensitivity, no files.
- `qaProfileFor`: Auto per CLI (a Codex tier with a null model), and Fixed.
- Settings: the defaults; a stored phase 1 value; out-of-range limits; a bad tier model.
- QaService: the run gets the tier's model and effort; `qa_tier` / `qa_tier_reason` and the log line;
  Fixed mode is unchanged.
- Web: the tier text in the popover, and the settings card through typecheck and build.

**Docs.** `09` (Model: Auto / Fixed, tiers, limits), `02` (the High-risk paths field), `06` (the tier in the
popover).

## Out of scope

- Blocking the merge on the server.
- Previewing a merge across several requirements.
- Trying the app (phase 2 of AI QA).
- Skipping repositories whose code did not change since a passed round, and incremental re-checks of only
  what changed since the last round (both discussed, not chosen for now).
- Choosing models by size and risk for the agents' coding runs.
