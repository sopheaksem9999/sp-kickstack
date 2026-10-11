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
  (`⎇ req/REQ-007/task-12`, with `✓` and the merge commit once merged), and buttons:
  **CLI Logs**, **Open Engine**, **Retry**, **Note**, **Mark Done** (each only when it applies).
- **Cross-Repo Dependency Links & Contracts**: who waits for whom (see [04](04-agents-tickets-and-questions.md#dependency-links)).

The page refreshes every few seconds, and toasts announce status changes.

## Task statuses

| Badge | Meaning |
|---|---|
| PENDING | Reserved by the bridge, not yet accepted by the engine. |
| QUEUED | The engine accepted it and has not started, or it was just released after a wait. |
| IN PROGRESS | The agent is working. |
| WAITING / HELD | Paused: it waits for a blocking ticket or for your answer to a question. |
| NEEDS HUMAN | The engine says the agent stopped and needs a person (see [05](05-answering-questions-and-notes.md#an-agent-needs-help-without-a-question)). |
| RATE LIMITED | Paused by an engine rate limit; it resumes on its own (see [08](08-rate-limits-and-retry.md)). |
| IN REVIEW | The agent finished; the work is ready for review. |
| QA / TESTING | Treated like IN REVIEW. (A Stoneforge `qa` status is shown as IN REVIEW.) |
| COMPLETE | Done (after the merge gate, or marked done). |
| FAILED | The engine reported a failure, or the bridge could not start it. Use **Retry**. |
| CLOSED | Cancelled. |

Placeholder cards titled `Waiting on <project> #<id>` stand for a blocking ticket another task
waits for.

## Change the requirement status by hand

Before fan-out, you can move a requirement freely (board drag, or the **State** select on its
page). Once any task exists, the status follows the tasks and only these moves are allowed:

| Move | Allowed when | Otherwise you see |
|---|---|---|
| To **QA** | Always. If task branches are not merged yet, this starts the merge gate (same as **Merge & move to QA**). | Merge gate errors, see [06](06-review-qa-and-merge.md) |
| To **Done** | No task is still active (all are complete, cancelled or failed). | `<n> task(s) are still active; finish or cancel them before marking <REQ-ID> done` |
| From **QA** to **In-Progress** | Always. The status is then worked out again from the tasks. | — |
| To **Cancelled** | Always (same as **Cancel**). | — |
| Anything else | Never. | `"<status>" is set automatically from task progress once <REQ-ID> is dispatched` |
| Anything, from Cancelled | Never. | `<REQ-ID> was cancelled after dispatch; create a new requirement instead of reopening it` |

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
- **The requirement stays In Progress although agents seem finished**: one task is not
  IN REVIEW or COMPLETE yet (it may be WAITING / HELD, NEEDS HUMAN or FAILED). Check each card.
- More messages: [Troubleshooting](10-troubleshooting.md).
