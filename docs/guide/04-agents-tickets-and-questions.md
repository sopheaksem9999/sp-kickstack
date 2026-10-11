# 04 Agents, tickets and questions

Agents use the `xticket` command to reach the bridge: `xticket create` files a ticket for
another project, and `xticket ask` asks a person a question and pauses the agent until the
answer arrives. This page is for whoever sets up the agents.

## Give agents the xticket command

1. Build it (the root build includes it):

   ```bash
   npm run build
   ```

2. Make `packages/xticket/dist/cli.js` available to agents as the command `xticket`. The
   package declares a `bin` named `xticket`; you can also run it as
   `node <path-to-repo>/packages/xticket/dist/cli.js`.
3. Set these environment variables in each agent's environment:

   | Variable | Default | What it is |
   |---|---|---|
   | `XTICKET_URL` | `http://127.0.0.1:4100` | Where the bridge server listens. |
   | `XTICKET_TOKEN` | none | Must equal the server's `AGENT_TOKEN` when that is set. Sent as `Authorization: Bearer <token>`. |
   | `XTICKET_PROJECT` | `unknown` | The bridge project name of the repository the agent works in, for example `mobile`. |
   | `XTICKET_TASK` | none | The **engine's** id for the agent's task (shown as `#<id>` on the task card). |

`XTICKET_PROJECT` and `XTICKET_TASK` tell the bridge which task is asking. Without them a ticket
cannot be linked to its requirement and a question is refused. The bridge does not set these
variables for you: how an engine passes its task id to the agent depends on the engine, so
check yours.

### Protect the agent routes with AGENT_TOKEN

If you start the server with `AGENT_TOKEN=<secret>`, these routes need
`Authorization: Bearer <secret>`: `POST /api/tickets`, `POST /api/agent/tickets` and
`POST /api/agent/questions`. Without `AGENT_TOKEN`, anyone who can reach the server can call
them. A wrong or missing token answers `Invalid or missing agent token`.

## What agents are told

Every goal prompt explains both commands. The question rule reads:

> **Questions for a person**: when a product decision (what users see, scope, data kept) is
> genuinely open and this requirement does not settle it, run
> `xticket ask --question "..." --option "..." --option "..."` (options are optional, up to 6),
> commit WIP changes, then stop. Your task is paused until a person answers; the answer arrives
> as a note when it resumes. Decide technical details yourself.

For other projects, the prompt says to run
`xticket create --to <project> --type api_request --title ... --body "..." --blocking` with a
precise contract (method, path, params, response, errors), commit work in progress, then stop.
Ticket prompts carry the same `xticket ask` rule.

## File a ticket: xticket create

```text
xticket create --to <project> --title <title> (--body <text> | --body-file <file>)
               [--type api_request|bug|question] [--blocking]
```

| Flag | Meaning |
|---|---|
| `--to` | Target project name (required). |
| `--title` | Ticket title (required, 3 to 250 characters). |
| `--body` / `--body-file` | What you need (required, 5 characters up to 20 KB). `--body-file` reads a markdown file. |
| `--type` | `api_request` (default), `bug` or `question`. Only `bug` may target the agent's own project. |
| `--blocking` | Pause the calling task until the ticket is finished. |

Example from a mobile agent:

```bash
xticket create --to backend --type api_request --blocking \
  --title "GET /v1/rides/nearby" \
  --body-file specs/REQ-007/nearby-contract.md
```

On success it prints the result and exits with 0:

```json
{"ticketId":14,"target":"backend","blocking":true,"status":"queued"}
```

### What happens next

- The bridge creates a **ticket** task for the target project (with its own branch for git
  projects) and sends it to that project's engine. The target agent is asked to check
  feasibility, plan, implement, update the contract file and add tests.
- **Not blocking**: the calling agent keeps working.
- **Blocking**: the bridge adds a placeholder `Waiting on <target> #<ticket id>`, links the
  calling task to the ticket, and pauses the calling task in its engine. It shows
  **WAITING / HELD**.
- When the ticket is finished (IN REVIEW for git projects, or COMPLETE), the waiting task is
  resumed with an "Update: dependency complete" message: the ticket number, where the work is
  (its branch, not merged yet), and how to read the contract file
  (`git -C <repo> show <branch>:<contract path>`). A task waiting on several things gets this
  message as a note each time and resumes after the last one.
- Filing the same ticket again (same task, target and title) returns the existing ticket.
- Limits: tickets can chain at most 3 deep (`Ticket depth limit exceeded (max: 3)`) and a
  requirement has at most 10 tickets (`Maximum tickets limit reached for requirement <REQ-ID>`).

### Dependency links

The requirement page lists links under **Cross-Repo Dependency Links & Contracts**
(`Task #<waiting> ➔ Depends on Task #<dependency>`), each with a state:

| State | Meaning |
|---|---|
| `waiting` | The dependency is not finished. |
| `ready` | The dependency is finished; the waiting task is about to be resumed. |
| `released` | The waiting task was resumed. |
| `error` | Resuming failed in the engine. The bridge retries up to 5 times. |
| `cancelled` | Nobody waits on it any more. |

If a dependency fails or is cancelled, the waiting task stays paused and you get a
"task is blocked" notification. You decide:

- **Retry** the failed ticket (see [08](08-rate-limits-and-retry.md#retry-a-stopped-task)).
- **Operator Release** (in the links panel, or **Release Link #<id>** in **Topology DAG**):
  release anyway. The waiting task resumes (unless something else still blocks it) with a
  message that the dependency was released before it finished and that the contract must be
  checked again. This also retries a link in `error`.
- Cancel the link with `POST /api/links/<link id>/cancel`. The waiting task resumes (unless
  something else still blocks it) and is told to continue without the dependency and note any
  gaps. There is no button for this.

## Ask a person: xticket ask

```text
xticket ask --question <text> [--option <label>]... [--body <text> | --body-file <file>]
```

| Flag | Meaning |
|---|---|
| `--question` | The question (required, 3 to 500 characters). |
| `--option` | A choice the person can click. Repeat it, up to 6. Each up to 120 characters, all different. |
| `--body` / `--body-file` | Context that helps the person decide (up to 20 KB). |

Example:

```bash
xticket ask --question "Should deleted users keep their past orders?" \
  --option "Keep orders, anonymised" --option "Delete orders" \
  --body "GDPR export currently includes orders; deleting them changes the export."
```

Output (exit code 0; printed on one line):

```json
{"questionId":42,"taskId":17,"status":"open","held":true,"answer":null,
 "message":"Your task is paused until a person answers. Stop working now; the answer arrives as a note when the task resumes."}
```

### What happens next

1. The bridge stores the question, links the asking task to it and pauses the task in its
   engine (**WAITING / HELD**). People see the question in the app and in their notification
   channels (see [05](05-answering-questions-and-notes.md)).
2. The agent should commit its work in progress and stop.
3. When a person answers, the task is resumed and receives:

   ```text
   ## Answer from a person
   You asked: Should deleted users keep their past orders?

   Keep orders, anonymised — keep the order totals for reporting

   Continue with this answer.
   ```

   If the task also waits on a blocking ticket, the answer arrives as a note right away, and
   again when the task is finally resumed.
4. Asking the same question again (same task, same text, ignoring case and spacing) does not
   create a second question. It returns the existing one; once answered, `status` is
   `answered` and `answer` holds the answer.

Whether and how quickly an agent reads a resumed task's context or a note depends on the engine.

## Exit codes

Both commands use the same exit codes:

| Code | Meaning |
|---|---|
| 0 | Created, or queued in the outbox for the bridge to send later. |
| 1 | The bridge refused it (for example unknown task, finished task, finished requirement). The reason is printed. |
| 2 | Invalid input (missing flag, too short, too many options, unknown target project). |
| 3 | A limit was hit (ticket depth or ticket count). |
| 4 | The bridge could not be reached **and** the outbox file could not be written. |
| 5 | Unauthorized: set `XTICKET_TOKEN` to the server's `AGENT_TOKEN`. |

`xticket --help` also lists `status` and `list`; they are not implemented yet and answer
`Unsupported command`.

## The outbox fallback

When the bridge cannot be reached, or answers with a server error (5xx, for example the target
engine is down or the task could not be paused), `xticket` writes the request to a file instead
and exits with 0 and `"status":"queued_outbox"`:

```text
.devflow/outbox/ticket-<time>-<random>.json
.devflow/outbox/question-<time>-<random>.json
```

The folder is relative to the folder `xticket` runs in. On every tick the bridge reads
`<Repository Path>/.devflow/outbox/*.json` for each enabled project, so **run `xticket` from the
repository root**. An agent that works in another clone or worktree must reach the bridge over
HTTP, because only the registered repository path is scanned.

What the bridge does with each file:

- Accepted: the file moves to `.devflow/outbox/processed/`. Filing is idempotent, so a request
  that also reached the bridge directly is not filed twice.
- Invalid or refused for good (bad input, unknown task, limits): the file moves to
  `.devflow/outbox/failed/` with a `<file>.error.txt` next to it, and the bell shows
  "A ticket from the outbox was rejected" (also for questions).
- A temporary problem (engine down, pause failed): the file stays and is tried on the next tick.

An agent with no network access can write such a file itself. A question file looks like this:

```json
{
  "kind": "question",
  "question": "Should deleted users keep their past orders?",
  "options": ["Keep orders, anonymised", "Delete orders"],
  "body": "",
  "project": "backend",
  "engineTaskId": "sf-123"
}
```

A ticket file has the fields `to`, `type`, `title`, `body`, `blocking`, `project` and
`engineTaskId`. Add `.devflow/` to each project's `.gitignore`.

## Calling the bridge without xticket

The same requests work over HTTP:

```bash
curl -s -X POST http://127.0.0.1:4100/api/agent/questions \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $XTICKET_TOKEN" \
  -d '{"question":"Keep past orders?","options":["Keep","Delete"],"project":"backend","engineTaskId":"sf-123"}'

curl -s -X POST http://127.0.0.1:4100/api/agent/tickets \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $XTICKET_TOKEN" \
  -d '{"to":"backend","title":"GET /v1/rides/nearby","body":"Return drivers within 2 km","blocking":true,"project":"mobile","engineTaskId":"sf-456"}'
```

A ticket that does not come from an agent task (for example from your own script) can name the
requirement instead: add `"req_id":"REQ-007"` to the ticket body.

## If something goes wrong

- **`A question must come from an agent task: set XTICKET_TASK to your engine task id`**:
  `XTICKET_TASK` is missing.
- **`No task <id> in project <name>`**: `XTICKET_PROJECT` or `XTICKET_TASK` does not match a
  goal or ticket the bridge sent. Compare with the `#<id>` on the task card.
- **`Cannot attribute ticket: source task not found and no req_id given`**: same cause, for
  tickets.
- **`Target project "<name>" is not registered`** or **`is disabled`**: check `--to` against the
  names under **Repositories**.
- **`Task #<id> is done; it cannot ask questions`** (or failed, cancelled), or
  **`Requirement <REQ-ID> is cancelled; it takes no questions`**: the work is over; nothing to ask.
- **Exit code 5 with `Host not allowed`**: the agent reaches the server under a host name the
  bridge does not accept (for example from a container). Add it to `ALLOWED_HOSTS`, and start
  the server with `HOST=0.0.0.0` if the agent is not on the same machine. See
  [Settings and environment](09-settings-and-environment.md).
- **Outbox files pile up in `.devflow/outbox/`**: the bridge keeps failing on them for a
  temporary reason (often a Down engine). Check the project's engine.
