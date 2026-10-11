# 07 Notifications

Notifications tell you when a person is needed: in the app (bell, toasts, the questions button)
and, if you set them up, on Slack, Telegram or any webhook.

## The bell

The bell sits at the top right of every page.

- A pink badge shows how many entries you have not read (`9+` above nine).
- Click the bell to open **Notifications**: newest first, each with a coloured dot (blue for
  information, green for success, amber for attention, red for errors), a title, a short detail
  and the time.
- Click an entry to open its requirement.
- **Mark all read** clears the badge.
- When there is nothing to show, it says "Nothing needs your attention."

The bell looks at the latest 50 events of the bridge and shows the ones meant for people:

| Bell title | When |
|---|---|
| `<project> agent asks a question` | An agent asked a question ([05](05-answering-questions-and-notes.md)) |
| `Question answered` | Someone answered a question |
| `<project> agent needs help` | An engine reports NEEDS HUMAN |
| `<REQ-ID> is ready for review` | The requirement reached In Review |
| `Changes requested on <REQ-ID>` | Someone pressed **Request changes** |
| `<REQ-ID> merged and moved to QA` | The merge gate succeeded |
| `Merge failed for <REQ-ID>` | The merge gate failed |
| `A <project> task failed` | A task failed or could not be started |
| `A task is blocked` | A task waits on work that failed or was cancelled, or resuming it keeps failing |
| `<project> engine is down` / `<project> engine is back` | Engine health changed |
| `<project> engine is rate limited` | An engine hit a rate limit ([08](08-rate-limits-and-retry.md)) |
| `A question from the outbox was rejected` or `A ticket from the outbox was rejected` | An outbox file was invalid or refused ([04](04-agents-tickets-and-questions.md#the-outbox-fallback)) |
| `A dependency was released` | A finished dependency resumed the tasks waiting on it |
| `A <project> task was retried` | Someone pressed **Retry** |

Routine status changes are not shown in the bell. The bell refreshes every minute and whenever
the app receives a live update.

## Toasts

While the app is open, short messages appear at the bottom right for live events, for example:
"<project> agent asks: …", "<project> agent needs help", "<REQ-ID> is ready for review",
"<REQ-ID> merged and moved to QA", "Merge failed for <REQ-ID>",
"<project> engine is rate limited until 15:30; work resumes automatically",
"New cross-repo ticket to <project>", and "Task status: <status> (<project>)" for every task
status change. Toasts are not stored; the bell
keeps the record.

## The questions button

While any agent waits for an answer, an amber **N questions** button appears next to the bell.
See [05](05-answering-questions-and-notes.md#where-questions-show-up).

## Send notifications to Slack, Telegram or a webhook

1. Open **Settings** and the **Notifications** tab.
2. Under **Links in messages**, enter the address people use to open the web app, for example
   `http://localhost:4101`. Leave it empty for messages without links.
3. Under **Channels**, click **Add channel** (up to 10 channels).
4. Choose the type: **Slack**, **Telegram** or **Webhook**.
5. Enter a name (for example "Team channel") and the URL (see below).
6. Leave the switch **On** (or set it **Off** to keep the channel without using it).
7. Under **Send these events**, switch events **On** or **Off**.
8. Click **Save**. **Discard changes** throws away unsaved edits.
9. Click **Test** on the channel. (Test is disabled until you save: "Save first, then test".)

### What happens next

**Test** sends a message titled "Test notification" with the text "Notifications from SP
Kickstack reach this channel." to that channel, even if it is switched off. A toast says `<name>: test message sent`, or explains what
failed. From then on, every switched-on event goes to every channel that is **On**.

### Slack

Create an incoming webhook in Slack and paste its URL, for example
`https://hooks.slack.com/services/T000/B000/XXXX`. Messages arrive as a bold title and the text.

### Telegram

Use the Bot API `sendMessage` URL with your bot token and chat id:

```text
https://api.telegram.org/bot<bot token>/sendMessage?chat_id=<chat id>
```

The bot must be able to post in that chat. Messages arrive as plain text (title, then the text),
without link previews.

### Webhook

Any `https://` (or `http://`) URL. The bridge sends an HTTP `POST` with
`Content-Type: application/json` and this body:

```json
{
  "type": "question_asked",
  "title": "backend agent asks a question (REQ-007)",
  "message": "Should deleted users keep their past orders?\nOptions: Keep orders, anonymised / Delete orders\nhttp://localhost:4101/requirements/REQ-007",
  "payload": {
    "questionId": 42,
    "taskId": 17,
    "reqId": "REQ-007",
    "project": "backend",
    "question": "Should deleted users keep their past orders?",
    "options": ["Keep orders, anonymised", "Delete orders"]
  }
}
```

`type` is the event name from the table below, `title` and `message` are the same text Slack and
Telegram get, and `payload` holds the event's details. Any 2xx answer counts as delivered.

## Event switches

| Switch | Event name | Default |
|---|---|---|
| **An agent asks a question** | `question_asked` | On |
| **An agent needs help** | `task_needs_human` | On |
| **A requirement is ready for review** | `requirement_in_review` | On |
| **Merged and moved to QA** | `merge_succeeded` | On |
| **A merge failed** | `merge_failed` | On |
| **A task failed** | `task_failed` | On |
| **A task is blocked** | `task_blocked` | On |
| **An engine is down** | `engine_down` | On |
| **An engine is rate limited** | `engine_rate_limited` | On |
| **Changes were requested** | `changes_requested` | Off |
| **A question was answered** | `question_answered` | Off |

Messages for events tied to a requirement end with a link to it when **Links in messages** is
set. Engine events (down, rate limited) have no link.

## How delivery works

- The bridge checks for new events on every tick (every 5 seconds by default, `WATCH_INTERVAL_MS`)
  and sends up to 100 per tick.
- **Each event is sent once**, also across restarts: the bridge remembers how far it got. If the
  server stops in the middle of sending, that event may be sent again after the restart.
- **No history on first start.** The first time notifications run, the bridge starts at the
  newest event; nothing older is sent.
- An event that happens while its switch is **Off**, or while no channel is **On**, is skipped
  for good. Switching it on later does not send old events.
- Each channel gets 10 seconds to answer. A slow or failing channel does not hold up the other
  channels or the rest of the bridge.
- **A failed delivery is not retried and not shown in the app.** The server log gets a line
  `[notify] <channel name>: <error>`; in the app only **Test** shows errors, so test a channel
  after every change.
- Slack and Telegram URLs contain secrets. They are stored in `bridge.db`; error messages show
  only the host name.

## If something goes wrong

- **Nothing arrives**: press **Test** on the channel and read the toast:
  - `No answer within 10 seconds. Check the URL and that the service is reachable.`
  - `Could not find the host <host>. Check the URL.`
  - `The host refused the connection. Check the URL and port.`
  - `The service answered HTTP <code>. Check the URL (and the token or chat id in it).`
- **Test works but events do not arrive**: check that the channel is **On**, that the event's
  switch is **On**, and that you clicked **Save**. Events that happened before you saved are not
  sent.
- **Messages have no links, or links do not open**: set **Links in messages** to the address of
  the web app as people reach it (not `localhost` if they are on other machines).
- **Saving fails with `"<name>" needs a URL starting with https://`**: paste the full URL,
  including `https://`.
- **`No notification channel "<id>". Save the channel first, then send the test again.`**: you
  tested a channel that is not saved yet.
