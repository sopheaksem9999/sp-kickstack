# 10 Troubleshooting

This page lists the messages you are most likely to see, what they mean and what to do. Error
messages appear as red toasts in the app; `<REQ-ID>`, `<id>` and similar parts are filled in.

## Messages when you change a requirement

| Message | Meaning | What to do |
|---|---|---|
| `"<status>" is set automatically from task progress once <REQ-ID> is dispatched` | After fan-out the status follows the tasks. You can only move to QA, to Done, from QA back, or cancel. | Let the tasks move it. See [allowed moves](03-requirements-and-fan-out.md#change-the-requirement-status-by-hand). |
| `<n> task(s) are still active; finish or cancel them before marking <REQ-ID> done` | Some task is not complete, cancelled or failed. | Finish the work, or cancel the requirement. |
| `<REQ-ID> was cancelled after dispatch; create a new requirement instead of reopening it` | Cancelled work cannot be reopened. | Create a new requirement. |
| `<REQ-ID> has unmerged task branches; use "Merge & move to QA" instead of confirming` | You pressed **Confirm merged**, but there are task branches the bridge must merge. | Use **Merge & move to QA**. |
| `Cannot edit requirement in status "<status>". Only ToDo and Ready for Dispatch stages can be edited.` | The text is locked after fan-out. | Send changes to agents with a **Note** or **Request changes**. |
| `Requirement <REQ-ID> has no enabled projects to fan out to` | No affected project is enabled. | Fix the projects with **Edit Repos**. |

## Messages about the merge

| Message | Meaning | What to do |
|---|---|---|
| `A merge of <REQ-ID> is running; wait for it to finish` | **Request changes** was pressed during a merge. | Wait until **Merging…** is gone, then try again. |
| `<REQ-ID> is already being merged` | A merge is already running. | Wait. |
| `<REQ-ID> is <status>; only a requirement in review can be merged and moved to QA` | The requirement is not In Review. | Wait for the tasks to finish. |
| `<n> task(s) of <REQ-ID> are not in review yet` | A task is still running, waiting or failed. | Check the task cards. |
| `Merge failed: …` | The merge gate stopped; nothing was pushed for the failing project. | See [When the merge fails](06-review-qa-and-merge.md#when-the-merge-fails). |
| `Interrupted by a restart; start the merge again` | The server restarted during a merge. | Click **Merge & move to QA** again. |

## Messages about tasks

| Message | Meaning | What to do |
|---|---|---|
| `Could not stop the old engine task <id> (<reason>); try again later` | **Retry** or **Request changes** must stop the old agent first, and the engine refused (or is rate limited) while the agent still works. Nothing was changed. | Try again later, or stop the task in the engine (**Open Engine**) first. |
| `Task #<id> is still waiting on another task; release or cancel that dependency first` | The task waits on a blocking ticket or an open question. | Answer the question, or release the link (see [04](04-agents-tickets-and-questions.md#dependency-links)). |
| `Task #<id> is <status>; only failed, stuck or rate-limited tasks can be retried` | **Retry** is for FAILED, NEEDS HUMAN and RATE LIMITED tasks. | Use **Note** for running work. |
| `Task #<id> changed meanwhile (another retry or review?); refresh and try again` | Someone else changed the task at the same moment. | Reload the page and check before trying again. |
| `Task #<id> is <status>; notes go to running agents (use Request changes for finished work)` | Notes only reach running agents. | Use **Request changes**. |
| `The <project> engine is rate limited; send the note again later` | The engine refuses calls until its reset. | Send the note again later. |
| `Task #<id> is <status>; only finished work can be sent back` | **Request changes** only works on IN REVIEW or COMPLETE tasks. | Wait, or use **Note**. |
| `Question #<id> is already answered` | Someone answered first. | Reload to see the answer. |
| `Base branch "<base>" was not found in <repo>` | The project's base branch does not exist. | Create it or fix **Base Branch**, then **Retry**. |

## Messages about the connection

| Message | Meaning | What to do |
|---|---|---|
| **Backend Bridge is offline** (banner) | The web app cannot reach the server on port 4100. | Start it with `npm run dev`. |
| `Host not allowed: <host>` | A request used a host name the server does not accept. | Add it to `ALLOWED_HOSTS`. |
| `Cross-site request blocked` | A browser page on another site called the API. | Open the app from an address listed in `WEB_ORIGINS`. |
| `Invalid or missing agent token` | An agent call lacks the right token. | Set `XTICKET_TOKEN` to the server's `AGENT_TOKEN`. |

## An agent stuck in WAITING / HELD

A held task waits for something. Find out what:

1. **An open question?** Look at **Questions from agents** on the requirement page, or the
   **N questions** button in the header. Answer it.
2. **A blocking ticket?** Look at **Cross-Repo Dependency Links & Contracts**. A `waiting` link
   means the ticket is not finished; follow that ticket's card. If the ticket FAILED or was
   CLOSED, **Retry** it, or press **Operator Release** to let the waiting task continue without
   it.
3. **A failed resume?** A link in state `error` and `Release failed: <reason>` on the card mean
   the engine refused to resume the task. The bridge retries up to 5 times; after that you get
   "Releasing the held task failed 5 times; release it in its engine manually". Press
   **Operator Release** to try again, or resume the task in the engine.
4. **None of these?** The engine itself reports the task as held (`deferred`, `held` or
   `waiting`). Click **Open Engine** and check there.

## An agent asked the same question twice

- **Same wording**: the bridge files it only once. Asking again returns the existing question,
  and its answer if it has one. Nothing to do.
- **Different wording**: it becomes a second question, and the task resumes only after **both**
  are answered. Answer the second one as well, for example "Same as my previous answer: keep
  orders". If the agent keeps asking, check that its engine passes the resumed context or notes
  to it, and that `XTICKET_TASK` is the same task id each time.

## Notifications do not arrive

1. Settings → **Notifications** → press **Test** on the channel. Read the toast; it says what to
   fix (URL, host, HTTP status, timeout).
2. Check that the channel is **On** and that the event's switch is **On**, then **Save**.
   Events that happened before saving are not sent later.
3. Check **Links in messages** if the links are missing or wrong.
4. Remember that a failed delivery is not retried and not shown anywhere. See
   [How delivery works](07-notifications.md#how-delivery-works).

## An engine stays Down

The bridge re-checks an engine only while the project has work running in it, and the automatic
retry skips projects marked Down. So a project whose goals never reached the engine can stay
**Down** after the engine is back, and its FAILED tasks are not retried by themselves.

1. Make sure the engine runs and answers `GET /health` at the **Engine URL**.
2. Press **Retry** on a FAILED task of that project. Once it reaches the engine, the next check
   marks the project **Online** and automatic retries resume.

The **Test** button on the project card does not check the engine; do not rely on it.

## Tests or the server fail on Node 24

SP Kickstack needs Node **22.19.0** (`.nvmrc`). Under other versions, for example Node 24, the
database driver `better-sqlite3` can fail to load, and `npm run verify`, `npm test` or the
server stop with a native-module error.

```bash
nvm use            # picks 22.19.0 from .nvmrc
npm install        # rebuild native modules for this Node version
npm run verify
```

## Other surprises

- **Project edits are undone after a restart**: the project is listed in `projects.yaml`, which
  is applied at every start. Edit the file. See [02](02-projects-and-engines.md#seed-projects-from-projectsyaml).
- **Requirements or projects seem to be missing**: the server uses a different `WORKSPACE_DIR`
  (it depends on the folder it starts in). See [where data lives](01-getting-started.md#where-your-data-lives).
- **Moving a requirement from QA to In-Progress marked it Done**: that move only works out the
  status again from the tasks; when all are complete and merged, the result is Done. Use
  **Request changes** to send work back.
- **The in-app diff does not show a task's changes**: it compares the folder's checked-out branch
  with `main`. Use `git diff <base>...req/<REQ-ID>/task-<id>` (see [06](06-review-qa-and-merge.md#look-at-the-changes)).
- **`xticket status` or `xticket list` says `Unsupported command`**: they are listed in the help
  but not implemented yet.
