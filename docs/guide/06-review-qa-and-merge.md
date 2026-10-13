# 06 Review, QA and merge

When the agents have finished, you review their work, send it back with comments or merge it,
and then check the merged result in QA before you mark the requirement done.

## When a requirement is In Review

A requirement moves to **In Review** by itself when no goal or ticket is still working: each one
(cancelled ones aside) is IN REVIEW or COMPLETE. (If all are COMPLETE and every branch is already
merged, it goes to Done instead.) You are told by:

- a toast and a bell entry: "<REQ-ID> is ready for review";
- your channels, if set up (event **A requirement is ready for review**, on by default).

With the **Auto-merge (no review)** policy the merge starts at this point by itself (see
[Merge policies](#merge-policies)).

## Look at the changes

Each task's work is on its branch `<REQ-ID>` (a ticket: `<REQ-ID>-ticket-<id>`; tasks created before 2026-10-13 keep `req/<REQ-ID>/task-<id>`) in the project's repository. The task
card shows the branch name.

- In the app, each repository's task card (In Review or QA) has **Changed files**, for example
  `Changed files 9 files · +120 −30`. Click it to list what the task committed on its branch: `A` added,
  `M` modified, `D` deleted or `R` renamed, with added and removed lines. Click a file to see its diff against
  the branch the task started from (the base branch, or the requirement's target branch). **Comment on this
  file** puts `#path` into that card's comment box. Work the agent did not commit is not shown.
- In a terminal, compare a task branch with its base branch:

  ```bash
  git -C /Users/you/dev/backend log --oneline develop..REQ-007
  git -C /Users/you/dev/backend diff develop...REQ-007
  ```

  The agent's own notes are in `specs/<REQ-ID>/` on that branch (`spec.md`, `plan.md`, and
  `decision.md` if it made choices for you).
- In the app, **Review Code & Git Changes** on the requirement page (or **Git Review** on a
  project card) opens a diff viewer with **Changes**, **Files** and **Commits**. It compares the
  branch **currently checked out in the project folder** with `main`. It does not switch to the
  task branch for you. If there is no `main` branch, it shows only uncommitted changes. Use the
  git commands above when you need the exact task diff.

## Comment on a task

While the requirement is In Review or QA, each repository's task card has a **Review comments**
section: in the side panel under **Per-Repo Agent Engines**, and on the full page under
**Task Columns**. A card keeps showing its comments afterwards.

1. Go to the card of the repository you tested (for example **BACKEND**).
2. Write the comment in the box ("What should the agent change?"), as in the requirement form:
   the toolbar adds **Bold**, *Italic*, `Code`, a code block (for errors and logs), bullet and
   numbered lists and links, and **Preview** shows the comment formatted (**Write** goes back).
   A comment can be up to 4000 characters. You can paste an error or log lines as they are.
   As in AI chat:
   - type `#` to pick a file changed on this task's branch, a repository or a requirement (add
     `:42` after a file for a line, for example `#src/api/users.ts:42`);
   - type `@` to pick a shared workspace asset (for example `@openapi.yaml`).

   ↑/↓ and Enter (or Tab) pick from the list; Escape closes it.

   The paperclip attaches files (screenshots, PDF, logs, txt, md, json, yaml, csv, xlsx); each
   shows as a chip you can remove before you add the comment.
3. Optional: click **Improve with AI**. It rewrites your text into one clear point for the agent:
   the problem, the key error lines as **Evidence**, what you **Expected**, and **Where**
   (as `#path:line`). It keeps your `#` and `@` references. It reads the requirement, the files
   changed on the task branch, and the code of the files you pointed at with `#` or that a pasted
   stack trace names, and the text of attached logs and text files (other files by name). It uses the AI CLI from Settings → AI & Local Engines (Claude Code, AGY or
   Codex), as text only: it changes no files. It can take up to 2 minutes. Check the result;
   **Undo** brings your text back. Nothing is saved yet.
4. Click **Add comment**. Repeat in other cards as needed.

Each comment shows its attached files (pictures as thumbnails; click to open or download) and its
state (comments made before 2026-10-13 also show their file, for example `src/api/users.ts:42`).
Attached files are kept in the bridge's workspace folder, under
`review-attachments/<REQ-ID>/<comment id>/`; deleting an open comment deletes them.



| State | Meaning | What you can do |
|---|---|---|
| `open` | Not sent yet. | **Resolve**, delete (trash icon) |
| `sent · round N` | Sent to the agent with **Request changes** in round N. | **Resolve** |
| `resolved` | Done with. | **Reopen**: it becomes `open` and is sent again with the next request |

Comments already sent cannot be deleted (`Comments already sent to an agent are kept; resolve
them instead`). Resolving is only for your bookkeeping; it does not tell the agent anything.

## Send work back with Request changes

1. Add at least one open comment.
2. Click **Request changes (N)**: on the **Per-Repo Agent Engines** heading in the side panel, or
   next to the repository count above the task columns on the full page. N is the number of open
   comments in all repositories; one click sends them all as one round. If the button is disabled,
   the text next to it says why: "Add a comment first" or
   "A merge is running; wait for it to finish".
3. The dialog **Request changes?** says how many comments go to how many agents.
4. Optional: to run the tasks you send back with another model or effort, click the button under
   **Pin a model for the tasks sent back (optional)**. The line under it says
   `The pin stays for later runs of those tasks until you clear it.` The button reads
   `Keep each task's setting` until you choose. Pick a model (`opus`, `sonnet`, `haiku`, `fable`,
   or another id typed into **Other model id**, then Enter) and/or an effort (`low`, `medium`,
   `high`, `xhigh`, `max`). **Keep** leaves each task's setting as it is.
5. Optional, only shown when a task that goes back has a pin: tick **Clear pins (use the
   requirement's or workspace's setting)**. The model and effort button is greyed out while it is
   ticked.
6. Click **Send to agents**. **Keep reviewing**, **Escape** or a click outside the dialog closes it
   without sending, and forgets what you chose in it.

### What happens next

For each task that has open comments (it must be IN REVIEW or COMPLETE):

1. The bridge stops the task's old engine task. If the engine refuses but the agent has already
   finished, that is fine.
2. It starts a new engine task **on the same branch**. The prompt is the original one plus:

   ```text
   ## Review feedback (round 2)
   A reviewer asked for changes. Keep working on `REQ-007`: address every point
   below, commit, and report back for review.

   1. `src/api/users.ts:42` — Return 404, not 500, for an unknown id
   2. General — Add a test for the empty list
   ```

   A comment's attached files follow it as
   ``Attached: `/…/review-attachments/REQ-007/14/screenshot.png` (image/png)``:
   the agent opens them by path. This works for Local AI CLI agents on this computer; a Stoneforge
   engine on another machine sees only the paths.

3. Its comments become `sent · round N`. Rounds count per requirement.
4. The task's earlier merge, if any, is forgotten: its new commits must go through the merge
   gate again.
5. If you chose a model or effort in step 4, it is **pinned** on each task that is sent back, and
   used for this new run and for every later run of that task, including later rounds that name no
   model (see [Which setting wins](03-requirements-and-fan-out.md#which-setting-wins)). The task
   card shows a marker such as `pinned: opus · max` next to the model line. If you ticked
   **Clear pins** in step 5, the pins of the tasks sent back are removed instead, and they run with
   the requirement's or the workspace's setting.

The requirement moves back to **In Progress**, and to **In Review** again when the agents finish.
A toast says `Round N sent: X tasks started a new run`.

About the model for the round:

- It only touches the tasks that are sent back (the ones with open comments). Other tasks keep
  their setting.
- Model and effort are pinned separately: choosing only an effort leaves the model as it was
  (the task's earlier pin, else the requirement's or the workspace's).
- A task that could not be sent back keeps its old pin.
- A pin you set stays for every later round until you replace it or tick **Clear pins**. Tasks that
  are IN REVIEW or COMPLETE have no **Retry**, so this dialog is where you clear their pins (for
  a failed task, **Clear pin** is in the **Retry** panel, see
  [08](08-rate-limits-and-retry.md#retry-with-a-different-model-or-effort)).
- Whether Stoneforge honours the model and effort is **not confirmed**, and a Manual project
  ignores them (see [02](02-projects-and-engines.md#model-and-effort-sent-to-the-engine)).

Only the comments of the current round are in the new prompt; earlier rounds are not repeated.
If an older point still matters, **Reopen** it before you press **Request changes**.

If some tasks could not be sent back, the toast lists them, for example
`Task #12: Could not stop the old engine task sf-88 (...); try again later`. Their comments stay
open; press **Request changes** again later. If none could be sent, you see
`No task could be sent back: <reason>`.

### From QA

You can also request changes while the requirement is in **QA**, after the merge. The dialog
then adds "the merge is redone afterwards". The new commits are made on the same branches, the
requirement goes back to **In Progress**, and once the work is in review again it is merged
again on top of what is already on the base branch. Earlier merged commits stay on the base
branch; to remove them, see [Roll back a merge](#roll-back-a-merge).

## Merge policies

| Policy | What it means |
|---|---|
| **Review first** (default) | A person starts the merge with **Merge & move to QA**. |
| **Auto-merge (no review)** | As soon as all work is in review, the bridge merges every task branch (after the project tests pass), pushes, and moves the requirement to QA. |

Where to set it:

- For everything: Settings → **Git & Branch Rules** → **Merge Policy**, then
  **Save Branch & Merge Rules**.
- For one requirement: the **Merge:** select on its page (**Workspace Default**,
  **Review first**, **Auto-merge (no review)**), or **Merge into Main** in the new-requirement
  form. A requirement's own choice wins over the default.

Agents are told the policy in their prompt at fan-out, so set it before you start the fan-out.

## Merge & move to QA

1. Wait until the requirement is **In Review**. The **Merge & move to QA** button appears when
   every task is IN REVIEW or COMPLETE and some branch is not merged.
2. Click **Merge & move to QA**. Dragging the card to the **QA / TESTING** column on the
   **Requirements** board starts the same merge.
3. A toast says "Merging… the requirement moves to QA when the merge succeeds". The button shows
   **Merging…** while it runs.

The **State** select on the requirement page is not a way to merge: while the requirement is In
Review it already shows **State: QA / Review**, so choosing that entry changes nothing.

### What happens next

With a **target branch** (see [Run settings](03-requirements-and-fan-out.md#run-settings)), "base"
below means the target branch: the merge goes into it instead of the base branch, and the target
branch is pushed to `origin`. If `origin` does not have it yet, the push creates it.

The merge is all-or-nothing across the requirement's projects:

1. **Prepare, for each project.** If the repository has an `origin` remote, the bridge fetches
   `origin/<base>`. It makes a temporary worktree in the system temp folder at the base branch,
   merges each task branch into it with a merge commit
   (`Merge <REQ-ID> task-<id>: <title>`, dependencies first), and runs the project's
   **Test Command**. Your branches are not touched in this phase.
2. **Check.** The requirement must still be In Review, every task still finished, and no branch
   may have moved since it was merged. Otherwise nothing is pushed.
3. **Publish.** With `origin`: the bridge pushes the result to `origin/<base>` (never forced),
   then fast-forwards your local base branch. Without `origin`: it fast-forwards the local base
   branch.
4. **Finish.** The requirement moves to **QA**. Merged tasks become COMPLETE. Each agent gets a
   note "Merged into `<base>`". If branch deletion is turned on (`auto_delete_branch`, see
   [Settings](09-settings-and-environment.md#git--branch-rules)), merged task branches are
   deleted. A toast and your channels say "<REQ-ID> merged and moved to QA", with any warnings.

Possible warnings (the merge still succeeded):

- `<project>: task #<id> (<branch>) had no new commits and was skipped`
- `origin has the merge, but local <base> could not be updated (...); run "git pull" there`
- `<path> has uncommitted changes on <base>; run "git merge --ff-only <sha>" there when ready`

Merges that touch the same repository run one after another.

## When the merge fails

The requirement stays **In Review**. The page shows `Merge failed: <first line>` in red (hover
for the whole text), and a toast, the bell and your channels say "Merge failed for <REQ-ID>".
Fix the cause, then click **Merge & move to QA** again.

| Message starts with | What to do |
|---|---|
| `<project>: merging <branch> (task #<id>) into <base> conflicts in <files>` | The agent got a note asking it to rebase onto the base branch and resolve the conflicts. If it does not act, add a comment such as "Rebase onto develop and resolve the conflicts in src/x.ts" and press **Request changes**, or resolve it yourself on the task branch. |
| `<project>: tests failed (exit <code>)` | The last 50 lines of test output follow. Send them back with **Request changes**, or fix the branch yourself. |
| `<project>: <path> has uncommitted changes on <base> and there is no origin to merge through` | Commit or stash the changes in that checkout. |
| `<project>: could not fetch <base> from origin` / `pushing <base> to origin failed` | Check access to the remote. The bridge's git never asks for a password, not even through an IDE's password box (VS Code, Antigravity); use SSH keys or a credential helper. `could not read Password for 'https://…': terminal prompts disabled` means origin needs a password that is not stored: run `git fetch` once in that repository from a terminal and enter it (on macOS the keychain keeps it; for Bitbucket or GitHub use an app password or token), or switch `origin` to SSH. Then merge again. |
| `branch <branch> changed during the merge (new commits); nothing was pushed — merge again` | Someone pushed to a task branch during the merge. Review the new commits, then merge again. |
| `Already merged and pushed: <projects>. Starting the merge again merges only the rest.` | Some projects were published before a later one failed. Fix the failing one and merge again. |
| `Interrupted by a restart; start the merge again` | The server restarted during the merge. Merge again. |

## Finish QA

1. Check the merged base branch (run the app, test the acceptance criteria).
2. If something is wrong, use **Request changes** (see [From QA](#from-qa)).
3. If all is well, set **State: Done** on the requirement page, or drag the card to
   **COMPLETE**.

The requirement shows **COMPLETE**. Moving to Done is refused while a task is still active
(`<n> task(s) are still active; ...`).

## Roll back a merge

The bridge does not undo merges. Each task branch was merged with its own merge commit; the task
card shows its short id after `✓`. To undo one on the base branch:

```bash
git -C /Users/you/dev/backend switch develop
git -C /Users/you/dev/backend pull
git -C /Users/you/dev/backend revert -m 1 <merge commit>
git -C /Users/you/dev/backend push origin develop
```

`git log --merges --grep "Merge REQ-007"` lists the requirement's merge commits. The bridge does
not see the revert; cancel the requirement or send it back with **Request changes** as you see
fit. Note that git will not merge the same reverted commits again; to bring them back later,
revert the revert.

## Work without task branches

Projects whose **Repository Path** is not the root of a git work tree get no task branches, so
the merge gate does not apply. When all their tasks are IN REVIEW or COMPLETE, the requirement
page shows **Confirm merged**. Merge the work yourself, then click it: the requirement moves to
**Done** and the toast says "Marked as merged (no git operation)".

## If something goes wrong

- **`<REQ-ID> is <status>; only a requirement in review can be merged and moved to QA`**: wait for
  In Review.
- **`<n> task(s) of <REQ-ID> are not in review yet`**: a task is still running, waiting or failed.
- **`<REQ-ID> is already being merged`**: a merge is running; wait for it.
- **`A merge of <REQ-ID> is running; wait for it to finish`** (from **Request changes**): same.
- **`Task #<id> is <status>; only finished work can be sent back`**: that task is not IN REVIEW or
  COMPLETE; use **Note** or **Retry** instead.
- **The header shows `develop` although your base branch is `main`**: that tag on the requirement
  page is a fixed label. The real base branch is each project's **Base Branch**.
