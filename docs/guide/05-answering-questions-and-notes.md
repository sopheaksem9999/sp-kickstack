# 05 Answering questions and notes

When an agent needs a decision it asks a question and pauses; you answer it here, and you can
also send a note to an agent while it works.

## Where questions show up

An agent's question (from `xticket ask`, see [04](04-agents-tickets-and-questions.md#ask-a-person-xticket-ask))
appears in several places at once:

- **Header button.** An amber **1 question** / **N questions** button appears at the top right
  while any agent waits. Click it to see **Waiting for your answer**: each line shows the
  requirement, the project and the question. Click a line to open that requirement. The button
  is hidden when nobody waits.
- **Requirement page.** The **Questions from agents** panel lists the questions of that
  requirement, open ones first (oldest first), with a **N waiting for you** count.
- **Bell.** "<project> agent asks a question", with the question text.
- **Toast.** "<project> agent asks: <question>", with "Open the requirement to answer; the agent
  waits until you do."
- **Slack, Telegram or webhook**, if set up (event **An agent asks a question**, on by default).
  The message lists the options and, if you set an app URL, a link to the requirement. See
  [Notifications](07-notifications.md).

While its run is going, the asking task shows **WAITING / HELD** until you answer.

## Answer a question

Open the requirement page. Each open question is a card: a first line that says what happens to
your answer, then the question, the agent's context (if any), its options (if any), a text box
and two buttons. The first line depends on the asking task:

| The card says | The asking task | Your answer |
|---|---|---|
| "The <project> agent is paused until you answer" | WAITING / HELD | Resumes the task. |
| "The <project> agent asked this while working; your answer goes to it as a note" | Still running, not paused (for example the pause failed) | Goes to the agent as a note. |
| "The <project> agent's run has ended; your answer is saved as a review comment for its next run" | IN REVIEW, QA, COMPLETE, FAILED or CANCELLED | Becomes an open review comment on that task (see [Answers to a finished run](#answers-to-a-finished-run)). |

### Pick an option

1. Click the option button.

The answer is the option text, for example `Keep orders, anonymised`.

### Pick an option and add a note

1. Type your note in the text box first.
2. Then click the option button.

The answer becomes `<option> — <your note>`, for example
`Keep orders, anonymised — keep the order totals for reporting`.

### Write your own answer

1. Type the answer in the text box (up to 4000 characters). When the agent offered options, you
   may still write something different.
2. Click **Send answer**.

### Let the agent decide

1. Click **Let the agent decide**.

The agent receives: `No preference: use your best judgment and note the choice in your report.`
Text in the box is not sent with it. Use this when the choice does not matter to you; look for
the agent's choice in its report or its `specs/<REQ-ID>/decision.md`.

### What happens next

The toast says how your answer reached the agent:

| Toast | What happened |
|---|---|
| **Answer sent; the agent continues** | The task was resumed with your answer. |
| **Answer sent; the agent continues once its other dependency is done** | The task also waits on a blocking ticket. The answer went to it as a note; the task stays WAITING / HELD and gets the answer again when it resumes (see [below](#a-question-while-the-agent-also-waits-on-a-ticket)). |
| **Answer sent to the agent as a note** | The task was not paused, so the answer went to it as a note. |
| **Answer saved as a review comment; use Request changes to send it to the agent** | The task's run had ended. See [Answers to a finished run](#answers-to-a-finished-run). |
| **Answer saved; it reaches the agent as soon as its engine responds** | The engine has not taken it yet (the pause was still being set up, or resuming failed). The bridge delivers it on its own and retries in the background; see [An agent stuck in WAITING / HELD](10-troubleshooting.md#an-agent-stuck-in-waiting--held) if the task stays held. |

In every case the card changes to `<project> · answered` and shows `→ <your answer>`, and the
bell shows "Question answered". (The matching Slack/Telegram/webhook event,
**A question was answered**, is off by default.)

When the task was paused and waits on nothing else:

- The bridge resumes the asking task in its engine, with this message:

  ```text
  ## Answer from a person
  You asked: <the question>

  <your answer>

  Continue with this answer.
  ```

- The task leaves WAITING / HELD (usually to QUEUED, then IN PROGRESS when the agent picks it up).

Only the first answer counts. If someone else answered a moment earlier, you see
`Question #<id> is already answered`; reload to see their answer.

## A question while the agent also waits on a ticket

A task can wait for a question and a blocking ticket at the same time. When you answer:

- the answer is sent to the agent right away as a note;
- the task stays **WAITING / HELD** until the ticket is finished too;
- when it is finally resumed, it gets your answer again together with the ticket update.

If the bridge could not pause the task when the question was asked (for example the engine
refused), your answer is sent as a note instead of resuming the task.

## Answers to a finished run

An agent's run can end before its question is answered, for example when the question waited in
the outbox (see [04](04-agents-tickets-and-questions.md#the-outbox-fallback)) and the agent
finished meanwhile. The bridge still shows the question but does not pause or reopen the task,
so its status (IN REVIEW, QA, COMPLETE) stays as it is.

When you answer such a question:

1. No message goes to the engine. The answer becomes an **open** comment on the task in the
   **Review comments** panel:
   `Answer to your question "<the question>": <your answer>`.
2. Press **Request changes** (see [06](06-review-qa-and-merge.md#send-work-back-with-request-changes))
   to start a new run of the task with it, together with any other open comments. If no new run
   is needed, **Resolve** the comment.

Request changes works for IN REVIEW and COMPLETE tasks. For a FAILED task, press **Retry** and
send the answer as a **Note** once the new run is going.

## Cancelled questions

Open questions are cancelled when their requirement is cancelled or reaches Done. They show
`<project> · cancelled` and cannot be answered (`Question #<id> is already cancelled`).

While a question is open, **Retry** on the asking task is refused with
`Task #<id> is waiting for an answer to question #<question id>; answer it (Let the agent decide is enough), then retry`.
Answer the question first; **Let the agent decide** is enough if you only want it to move on.

## An agent needs help without a question

Some agents stop without using `xticket ask`. When the engine reports such a state (see the
status table in [02](02-projects-and-engines.md#stoneforge)), the task shows **NEEDS HUMAN**:

- the toast and the bell say "<project> agent needs help";
- they show the engine's summary text if the engine sends one (the bell otherwise shows
  "Waiting for a person"). Whether your engine sends a summary is not confirmed; often you get
  no text at all;
- the event **An agent needs help** goes to your channels (on by default).

There is no question card and no answer box in this case. What you can do:

1. Click **Open Engine** on the task card to read what the agent wrote in its engine.
2. Send it a **Note** with the missing information (see below). Whether a note gets a stopped
   agent going again depends on the engine.
3. Or click **Retry**: the old engine task is stopped and a new run starts on the same branch,
   keeping the commits but not the agent's conversation (see
   [Retry](08-rate-limits-and-retry.md#retry-a-stopped-task)).

## Send a note to a running agent

Use a note to correct course while an agent works ("use the v2 endpoint").

1. On the requirement page, find the task card and click **Note**. The button is shown for goals
   and tickets that reached their engine and are QUEUED, IN PROGRESS, NEEDS HUMAN,
   WAITING / HELD or RATE LIMITED.
2. In **Note to the <project> agent**, type the note (up to 4000 characters).
3. Click **Send note**.

### What happens next

- A toast says **Note sent to the <project> agent**.
- The engine adds it to the agent's task as:

  ```text
  ## Note from a person
  <your note>
  ```

- The engine decides when the agent reads it. As the dialog says: "Whether it reads it right
  away depends on its engine." A note does not resume a paused task and does not restart a
  finished one.
- **Local AI CLI** repositories: the note is saved and the agent reads it when its next run starts
  (after an answer, a usage limit, **Retry** or **Request changes**). An agent that is running now
  does not see it.

### Limits of notes

- Notes are for running work. For finished work (IN REVIEW, COMPLETE) the server answers
  `Task #<id> is in_review; notes go to running agents (use Request changes for finished work)`.
  Use [Request changes](06-review-qa-and-merge.md#send-work-back-with-request-changes).
- A note is sent once. It is not retried if the engine fails:
  - `The <project> engine is rate limited; send the note again later`
  - `Could not send the note to <project>: <reason>`
- For **Manual** projects the note is accepted but nobody receives it; there is no agent.

## If something goes wrong

- **The header button shows a question but the requirement page has no card**: reload the page;
  the button refreshes every 30 seconds.
- **The task stays WAITING / HELD after you answered**: it may also wait on a ticket (check
  **Cross-Repo Dependency Links & Contracts**), or resuming failed in the engine. See
  [An agent stuck in WAITING / HELD](10-troubleshooting.md#an-agent-stuck-in-waiting--held).
- **The agent asked the same thing twice**: see
  [Troubleshooting](10-troubleshooting.md#an-agent-asked-the-same-question-twice).
