# 03 Requirements and fan-out

A requirement describes one piece of work; fan-out sends it to the engine of every project it
affects, as one goal per project on its own branch.

## Write a requirement with the form

1. In the sidebar, click **New Requirement**. A panel opens on the right, on the
   **Specification Form** tab.
2. Type a **Requirement Title** (required, up to 200 characters).
3. Under **Affected Repositories / Engines**, click every project that must change
   (**Select All** and **Clear** help). At least one is required.
4. Describe the work in **Goal & Problem Context (Rich Text)**. If you leave it empty, the title
   is used. **Template** inserts a starting structure; **Attach Files** adds files.
5. Optional: **User Story (Optional)** and **Acceptance Criteria (Optional)** (**Add Criterion**
   adds a line).
6. Optional settings at the top: **State**, **Priority**, **Sprint**, and **Merge into Main**
   (**Workspace Default**, **Review first** or **Auto-merge (no review)**; see
   [merge policies](06-review-qa-and-merge.md#merge-policies)).
7. Save:
   - **Save State (ToDo)** saves it without starting work.
   - **Create & Fan-Out** saves it and starts the fan-out at once.

Agents see your text as the requirement. Write what must be true when the work is done, not how
to type it. Name APIs, screens and data that matter.

### Let AI draft it

- In the form, open **Draft with AI Assistant**, describe the idea in one line and click
  **Generate**. The title, goal, criteria and projects are filled in for you to check.
- Or switch to the **💬 Discuss with Local AI** tab, talk the feature through, then click
  **Transfer to Requirement Form** on the proposed spec.
- Or use **AI Architect Chat** in the sidebar: discuss in a chat session, then click
  **Create Requirement (/create)** or type `/create`. The requirement is created in To Do.

The AI provider is chosen in Settings → **AI & Local Engines**.

### Edit a requirement

You can edit the text only while it is To Do (badge TO DO) or Ready (badge READY). On the
board, click the card and use **Edit Spec** in the side panel. Once fan-out has started, the
panel shows **View Only** instead, and the server refuses edits with
`Only ToDo and Ready for Dispatch stages can be edited.`

## Choose the agent model and effort

Optional. Without a choice, each engine runs its agents with the model and effort it is
configured with. You can choose them for a whole workspace, for one requirement or for one task.

- **Model**: the name the engine understands. The app suggests `opus`, `sonnet`, `haiku` and
  `fable`; any other id works too (it starts with a letter or digit, then letters, digits and
  `.` `_` `:` `/` `-`, up to 80 characters in all, for example `claude-opus-5-5`).
- **Effort**: `low`, `medium`, `high`, `xhigh` or `max`.

### Which setting wins

Model and effort are worked out **separately**, every time the bridge sends a task to its engine.
For each of them, the first line of this table that has a value is used:

| Order | Where it is set | How you set it |
|---|---|---|
| 1 | The task (a **pin**) | **Retry** with a model ([08](08-rate-limits-and-retry.md#retry-with-a-different-model-or-effort)), or **Request changes** with **Pin a model for the tasks sent back (optional)** ([06](06-review-qa-and-merge.md#send-work-back-with-request-changes)) |
| 2 | The requirement | **Agent:** on the requirement page (see below) |
| 3 | The workspace | **Default agent model & effort** in **Shared Rules & Context** ([02](02-projects-and-engines.md#workspaces)) |
| 4 | Nothing | The engine uses its own configuration |

Example: the workspace says `sonnet` and `medium`, and the requirement sets only the effort
`high`. Its tasks run as `sonnet · high`: the model comes from the workspace, the effort from the
requirement. If you then retry one task with the model `opus`, that task runs as `opus · high`.

What **Default** means depends on where you see it:

- In the requirement's **Agent:** control and in the workspace dialog, **Default** means "do not
  choose here": the next line of the table decides.
- In the **Retry** panel and in the **Request changes** dialog the chips read **Keep** instead of
  **Default**, because they mean "keep this task's setting": its pin if it has one, otherwise the
  requirement's and the workspace's.
- **Clear pin (use the requirement's or workspace's setting)** in the **Retry** panel, and
  **Clear pins (use the requirement's or workspace's setting)** in the **Request changes** dialog,
  remove the pin, so the requirement's and the workspace's settings apply again. Each is shown
  only when a task it affects has a pin.

A pin stays on the task. Every later run of that task uses it, including the automatic retries
after a failed start, and every later **Request changes** round, until you clear it or replace it.
A pin belongs to the one task: a ticket that a pinned goal files does not inherit the goal's pin,
it uses its requirement's or workspace's setting.

### Set it on a requirement

1. Open the requirement page (see [Start the fan-out](#start-the-fan-out)).
2. In the header, next to **Merge:**, click the **Agent:** button. It reads `Engine default` when
   nothing is set anywhere, or `Default: sonnet · high (workspace)` when the workspace has a
   default, or your own choice such as `opus · high`. If you choose only one of the two, the button
   also shows the other one from the workspace, for example `sonnet · high` for an effort `high`
   and a workspace model `sonnet`; hover over it to see which part comes from the workspace.
3. Under **Model**, click **Default**, a model (`opus`, `sonnet`, `haiku`, `fable`), or type
   another id into **Other model id** and press Enter. A red hint means the id was not accepted
   and it is not used.
4. Under **Effort**, click **Default** or one of `low`, `medium`, `high`, `xhigh`, `max`.

There is no Save button: every click is saved at once, and a toast says
`Agent model saved; it applies to runs started from now on (tasks with a pin keep their pin)`.

You can set it at any stage, including before **Start Fan-Out**. Set it first if the first run
should already use it.

### What happens next

- The choice is read when a task is **started**, not before: fan-out, a ticket an agent files,
  **Retry**, **Request changes**, and the automatic retries of a start that failed. An agent that
  is already running is not changed.
- The bridge puts the model and effort into the request that creates the goal or ticket in the
  engine. A part with no value is left out. See [02](02-projects-and-engines.md#model-and-effort-sent-to-the-engine)
  for what engines do with it: Manual projects ignore them, and whether Stoneforge honours them is
  **not confirmed**.
- The task card shows what was sent (see below).

## Start the fan-out

1. Open the requirement page: click a card on the **Requirements** board, then the
   **Open full page** icon at the top of the side panel. (Links in the bell and the questions
   button open this page directly.)
2. Click **Start Fan-Out**. It is shown while the requirement is To Do or Ready.

### What happens next

For each affected project that is enabled, the bridge:

1. Creates one **goal** task.
2. For git projects, creates the branch `req/<REQ-ID>/task-<id>` from the project's base branch.
3. Sends the goal to the project's engine, with a prompt that contains:
   - your requirement text (marked as untrusted input, so instructions inside it are treated as
     data);
   - the branch rules: work and commit only on the task branch, never merge into the base
     branch; the bridge merges;
   - what to do: write `specs/<REQ-ID>/spec.md` and `specs/<REQ-ID>/plan.md`, implement, follow
     the repository's `AGENTS.md` / `CLAUDE.md`, add tests;
   - how to file a ticket (`xticket create`) and how to ask a person (`xticket ask`), see
     [Agents, tickets and questions](04-agents-tickets-and-questions.md);
   - the names and notes of the workspace's shared files from **Attachments Hub**.

The requirement moves to **In Progress** as soon as one goal reaches its engine. If every goal
fails to start, a To Do requirement moves to **Ready** so you can try again.

Starting a goal is tried 3 times in a row. If it still fails, the task shows **FAILED** with the
error, and the bridge keeps retrying in the background
(see [Rate limits and Retry](08-rate-limits-and-retry.md#automatic-retries)).

Fan-out never creates a second active goal for the same project.

## Follow the work

The requirement page shows:

- **Questions from agents** and **Review comments** panels, when there is something to show
  (see [05](05-answering-questions-and-notes.md) and [06](06-review-qa-and-merge.md)).
- **Execution Views**: **Task Columns** (one column per project) or **Topology DAG** (tasks and
  their dependencies as a graph).
- On each task card: the status badge, `Role: goal` or `Role: ticket`, the branch
  (`⎇ req/REQ-007/task-12`, with `✓` and the merge commit once merged), the model and effort the
  run was sent with, and buttons: **CLI Logs**, **Open Engine**, **Retry**, **Note**,
  **Mark Done** (each only when it applies). **Retry** has a small arrow next to it for retrying
  with another model, except on tasks of Manual projects (see
  [08](08-rate-limits-and-retry.md#retry-with-a-different-model-or-effort)).
- **Cross-Repo Dependency Links & Contracts**: who waits for whom (see [04](04-agents-tickets-and-questions.md#dependency-links)).

The page refreshes every few seconds, and toasts announce status changes.

### The model line on a task card

Under the `Role:` line, a card shows the model and effort its current run was sent with:
`opus · high`, just `opus`, or `high effort` when only the effort is set. Hover over it to read
`Model and effort sent with this run`. A small marker such as `pinned: opus · max` next to it means
a person pinned that model or effort on this task with **Retry** or **Request changes**; its tooltip
is `Pinned for this task by Retry or Request changes`. To remove the pin, see
[Which setting wins](#which-setting-wins).

- It shows what the **bridge sent** to the engine. It is not proof that the agent used it: whether
  Stoneforge honours the model and effort is not confirmed (see
  [02](02-projects-and-engines.md#model-and-effort-sent-to-the-engine)).
- The model and effort are blank while a task has not been sent yet, and right after **Retry** or
  **Request changes** until the new run has been sent.
- Tasks of **Manual** projects show no model, no **pinned** marker and no arrow next to **Retry**: no agent runs for them, so a model or effort would have no effect.

## Task statuses

| Badge | Meaning |
|---|---|
| PENDING | Reserved by the bridge, not yet accepted by the engine. |
| QUEUED | The engine accepted it and has not started, or it was just released after a wait. |
| IN PROGRESS | The agent is working. |
| WAITING / HELD | Paused: it waits for a blocking ticket or for your answer to a question. |
| NEEDS HUMAN | The engine says the agent stopped and needs a person (see [05](05-answering-questions-and-notes.md#an-agent-needs-help-without-a-question)). |
| RATE LIMITED | Paused by a rate limit. A start the bridge held back is retried automatically; a task the engine reports as rate limited continues when the engine resumes it (see [08](08-rate-limits-and-retry.md)). |
| IN REVIEW | The agent finished; the work is ready for review. |
| QA / TESTING | Treated like IN REVIEW. (A Stoneforge `qa` status is shown as IN REVIEW.) |
| COMPLETE | Done (after the merge gate, or marked done). |
| FAILED | The engine reported a failure, or the bridge could not start it. Use **Retry**. |
| CLOSED | Cancelled. |

Placeholder cards titled `Waiting on <project> #<id>` stand for a blocking ticket another task
waits for.

## Agent Queue

**Agent Queue** in the sidebar (badge **Live**) lists the agents' tasks of the active workspace in
one place, across all its requirements and projects. Use it to see what is running, what is stuck
and what needs you, without opening each requirement.

- It lists **goals** and **tickets** only. Questions for a person (see
  [05](05-answering-questions-and-notes.md)) and the `Waiting on <project> #<id>` placeholder cards
  are not listed.
- It shows the active workspace only. Choose another workspace in the sidebar to see its tasks.
- The most recently updated task is first.
- A card shows the requirement id (a button), the priority when it is `urgent` or `high`, the
  project, `goal` or `ticket`, the branch, the status badge, the task title, the engine ID and
  `Updated 5 minutes ago`. From the second start it also shows `Attempt <n>`. A RATE LIMITED task
  shows when it resumes, and a stopped task shows its last error.

### Tabs

| Tab | Shows |
|---|---|
| **All Tasks** | Every task, including those no other tab shows: WAITING / HELD, IN REVIEW, QA / TESTING and CLOSED. |
| **Queued** | QUEUED and PENDING. |
| **In Progress** | IN PROGRESS. |
| **Failed / Needs Human** | FAILED, NEEDS HUMAN and RATE LIMITED. |
| **Completed** | COMPLETE. |

The number on a tab is how many tasks it shows with the current search and repository filter.
The tab is kept in the address: `?tab=queued`, `?tab=running`, `?tab=failed` or `?tab=done`
(**All Tasks** needs none). The browser's Back and Forward buttons, a reload and a copied link all
bring you back to the same tab. Use the arrow keys to move between the tabs and Enter or Space to
open one.

### Filters

- **Search tasks**: type part of a task title, a requirement id or title, a project, a branch or an
  engine ID. Capital letters do not matter. The **x** in the box clears it.
- **All repositories**: opens a list of the workspace's projects. Choose one to see only its tasks
  (arrow keys and Enter work, Esc closes the list), or choose **All repositories** to see every
  project again.

The filters work together with the tab. When nothing matches, the page says
`No tasks match this view`. When the workspace has no goals or tickets yet it says
`No agent tasks in this workspace yet`; they appear after **Start Fan-Out** on a requirement.

### What you can do on a card

- **Logs**: opens the task's terminal output and events, the same panel as **CLI Logs** on the
  requirement page.
- **Retry**: shown for a FAILED, NEEDS HUMAN or RATE LIMITED goal or ticket whose requirement is
  not Done or Cancelled. It does the same as **Retry** on the requirement page
  (see [08](08-rate-limits-and-retry.md)): the task is sent to its engine again on its branch.
  There is no arrow here; to retry with another model or effort, use the requirement page.
- **Mark Done**: shown until the task is COMPLETE or CLOSED. See
  [Mark a task done](#mark-a-task-done).
- The requirement id (for example `REQ-007`): opens that requirement's side panel.

A toast tells you the result. When an action fails, the toast gives the reason and asks you to
refresh the queue to see the task's current state.

### Keeping it up to date

The queue refreshes by itself when the bridge reports a change, and at least every 10 seconds.
**Refresh** reloads it at once. If the bridge cannot be reached, the page says
`The queue could not be loaded`, or `Could not refresh the queue` above the last result it has,
and tries again on its own; start the bridge (`npm run dev`) and press **Refresh**.

## Change the requirement status by hand

Before fan-out, you can move a requirement freely (board drag, or the **State** select on its
page). Once any task exists, the status follows the tasks and only these moves are allowed:

| Move | Allowed when | Otherwise you see |
|---|---|---|
| To **QA** | Always. If task branches are not merged yet, this starts the merge gate (same as **Merge & move to QA**); drag the card to the **QA / TESTING** column to do it from the board. | Merge gate errors, see [06](06-review-qa-and-merge.md) |
| To **Done** | No task is still active (all are complete, cancelled or failed). | `<n> task(s) are still active; finish or cancel them before marking <REQ-ID> done` |
| From **QA** to **In-Progress** | Always. The status is then worked out again from the tasks. | — |
| To **Cancelled** | Always (same as **Cancel**). | — |
| Anything else | Never. | `"<status>" is set automatically from task progress once <REQ-ID> is dispatched` |
| Anything, from Cancelled | Never. | `<REQ-ID> was cancelled after dispatch; create a new requirement instead of reopening it` |

While a requirement is In Review, the **State** select on its page already shows
**State: QA / Review**, so you cannot pick it to merge; use **Merge & move to QA** or drag the
card on the board.

Moving from QA back to In-Progress does not tell any agent anything. If every task is complete
and merged, the requirement goes straight to **Done**. To get changes, use
[Request changes](06-review-qa-and-merge.md#send-work-back-with-request-changes).

## Change the affected projects

**Edit Repos** opens **Edit Affected Repositories**; pick projects and click **Save Repos**.
After fan-out, a project you add gets no goal from the page (**Start Fan-Out** is only shown in
To Do and Ready). To create goals for added projects, call `POST /api/requirements/<REQ-ID>/ready`;
it creates goals only for projects that have none (and restarts goals that never reached their
engine).

## Mark a task done

**Mark Done** sets a task to COMPLETE in the bridge. Use it for **Manual** projects when the work
on the task branch is finished.

- It also releases tasks that waited for this one and updates the requirement status. For a git
  project the requirement then reaches **In Review** and the work still goes through the merge
  gate.
- On an engine project it only changes the bridge's record. It does not stop or finish the
  agent, and the bridge stops watching that task.
- It does not work on questions: answer them instead.

## Cancel a requirement

1. Click **Cancel** on the requirement page.
2. Confirm with **Yes, Cancel Requirement** (or **Keep Requirement** to go back).

### What happens next

- The requirement becomes **Cancelled** (CLOSED).
- Every active task is cancelled in its engine, so no agent keeps working. Open questions are
  cancelled. Waiting dependency links are cancelled.
- If an engine refuses to cancel, that task keeps its status with `Cancel failed: <reason>`, and
  the bridge tries again in the background (up to 5 times). After that you get a "task failed"
  notification asking you to stop those agents by hand.
- Branches and anything already merged stay as they are.
- A cancelled requirement cannot be reopened. Create a new one.

## If something goes wrong

- **`Requirement <REQ-ID> has no enabled projects to fan out to`**: add a project with
  **Edit Repos**, or enable the project.
- **A goal shows FAILED right after fan-out**: read the error on the card (wrong Engine URL,
  missing base branch, engine down). Fix it, then press **Retry**.
- **The task card shows no model although you chose one**: the choice only counts for runs started
  after you made it, the task may not have been sent to its engine yet, or its project is
  **Manual**. A running agent is not changed; **Retry** (when the card offers it) or
  **Request changes** starts a new run that uses the choice.
- **The card shows a model, but the agent seems to use another one**: the card shows what the
  bridge sent. Check in the engine itself, because whether Stoneforge honours it is not confirmed.
- **The requirement stays In Progress although agents seem finished**: one task is not
  IN REVIEW or COMPLETE yet (it may be WAITING / HELD, NEEDS HUMAN or FAILED). Check each card.
- More messages: [Troubleshooting](10-troubleshooting.md).
