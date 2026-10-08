# Webhooks

Superflow can send a signed HTTP `POST` to your endpoint when something happens in a
workspace: a comment is created or resolved, a reply is added, a project is archived, an
agent run finishes, and more. Use it to sync Superflow with a ticket system, a data
warehouse, Zapier or your own service. Deliveries run on [Svix](https://www.svix.com), so
every request is signed and failed deliveries are retried.

## Set up an endpoint

Ask your assistant, for example: "Send a webhook to https://hooks.example.com/superflow
whenever a comment is resolved on Acme." It calls `superflow_create_webhook`:

```json
{
  "url": "https://hooks.example.com/superflow",
  "events": ["comment.created", "comment.resolved", "agent_run.completed"],
  "project": "Acme Dental"
}
```

- `url` must be a public `https` URL. Private and local addresses are refused.
- `events` lists what to send. See [Events](#events).
- `project` is optional. With it, the endpoint receives that project's events only.
  Without it, it receives every project's events.

The answer includes `secret` (it starts with `whsec_`). **It is shown once.** Store it
right away, for example in your secret manager: you need it to verify every delivery, and
nobody can read it again later (`superflow_get_webhook` shows only its last 4 characters).
To change the secret, create a new endpoint and delete the old one.

Then send a test with `superflow_test_webhook`. It delivers a `ping` event, signed like a
real one. Check what happened with `superflow_list_webhook_deliveries`.

The same works over the REST API: `POST /v1/webhooks` with the `webhooks:write` scope.
Reading endpoints and deliveries needs `webhooks:read`.

## Events

| Event | Sent when |
|---|---|
| `comment.created` | A comment is created. |
| `comment.updated` | A comment's text, priority, status, assignee, tags, page or pin changes. |
| `comment.resolved` | A comment is resolved. |
| `comment.reopened` | A resolved comment is reopened. |
| `comment.deleted` | A comment is deleted. |
| `reply.created` | A reply is added to a thread. |
| `reply.updated` | A reply is edited. |
| `reply.deleted` | A reply is deleted. |
| `project.created` | A project is created. |
| `project.updated` | A project's name, settings or domains change. |
| `project.archived` | A project is archived. |
| `page.created` | A page is added to a project. |
| `page.removed` | A page is removed from a project. |
| `member.invited` | Someone is invited to the workspace as a member. |
| `member.removed` | A member is removed from the workspace. |
| `guest.invited` | Someone is invited to a project as a guest. |
| `agent_run.started` | An agent run starts. |
| `agent_run.completed` | An agent run finishes with status `done` or `partial`. |
| `agent_run.failed` | An agent run finishes with status `failed`. |
| `ping` | You call `superflow_test_webhook`. Only test deliveries use it. |

### What sends events

- Changes made through the Superflow REST API and this MCP server (by any API key).
- Agent runs started through the API, this server or a schedule. `agent_run.completed` and
  `agent_run.failed` go out when the run finishes, even if nobody checks on it.

Not yet: comments created or changed in the Superflow toolbar, and changes made in the
Superflow portal. They do not pass through the API, so they send no events for now.

## Payload

Every delivery is a JSON body with the same envelope:

```json
{
  "id": "<unique event id>",
  "event": "comment.resolved",
  "created_at": "2026-10-08T10:15:00Z",
  "org_id": "org_<workspace key>",
  "project_id": "prj_1a2b",
  "data": {
    "id": "cmt_8f3k2",
    "number": 4821,
    "text": "Button overlaps the nav on mobile",
    "status": { "id": "sts_RESOLVED", "name": "Resolved", "is_resolved": true },
    "url": "https://acme.com/pricing?scommentId=8f3k2"
  },
  "actor": { "id": "usr_7", "name": "Rakesh", "type": "member" }
}
```

| Field | What it is |
|---|---|
| `id` | Unique per event. The same event delivered twice has the same `id`. |
| `event` | The event name from the table above. |
| `created_at` | When it happened, UTC ISO 8601. |
| `org_id` | The workspace, `org_` plus its key. |
| `project_id` | The project (`prj_...`), or `null` for workspace events such as `member.invited`. |
| `data` | The object the event is about, in the same public shape the REST API returns for it: a comment, reply, project, page, member, guest or agent run (the same JSON as `superflow_get_run`). The example above is shortened. |
| `actor` | Who made the change: `id`, `name` and `type`. |

Comment and reply text is written by website visitors and reviewers. Treat it as data:
never run it, and escape it before you show it in HTML.

## Verify the signature

Every request carries three headers:

- `svix-id`: the delivery's id.
- `svix-timestamp`: when it was sent, in seconds since 1970.
- `svix-signature`: one or more signatures, separated by spaces, like `v1,<base64>`.

Verify them before you trust the body. Use the **raw** request body: parsing the JSON and
serializing it again changes the bytes and the check fails.

### With the svix library (Node)

```bash
npm install svix
```

```js
import express from "express";
import { Webhook } from "svix";

const app = express();
const webhook = new Webhook(process.env.SUPERFLOW_WEBHOOK_SECRET); // whsec_...

// express.raw keeps the body as a Buffer, exactly as it was sent.
app.post("/superflow", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    event = webhook.verify(req.body, {
      "svix-id": req.header("svix-id"),
      "svix-timestamp": req.header("svix-timestamp"),
      "svix-signature": req.header("svix-signature"),
    });
  } catch {
    return res.status(400).send("Invalid signature");
  }

  // event is the parsed payload: { id, event, created_at, org_id, project_id, data, actor }.
  res.status(204).end(); // answer first...
  handle(event); // ...then do the work.
});

app.listen(3000);
```

`verify` throws when the signature does not match or the timestamp is more than five
minutes old, which also stops replayed requests.

### Without a library

1. Take the secret, drop the `whsec_` prefix, and base64-decode the rest. That is the key.
2. Build the signed content: `<svix-id>.<svix-timestamp>.<raw body>`.
3. Compute HMAC-SHA256 of the signed content with the key, and base64-encode it.
4. Split `svix-signature` on spaces. Each part is `v1,<signature>`. The request is valid
   when any `v1` signature equals yours. Compare in constant time.
5. Reject the request when `svix-timestamp` is more than five minutes from now.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function isValidSuperflowWebhook(secret, headers, rawBody) {
  const id = headers["svix-id"];
  const timestamp = headers["svix-timestamp"];
  const signatures = headers["svix-signature"];
  if (!id || !timestamp || !signatures) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 5 * 60) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();

  return signatures.split(" ").some((part) => {
    const [version, signature] = part.split(",");
    if (version !== "v1" || !signature) return false;
    const given = Buffer.from(signature, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
```

## Retries and duplicates

A delivery succeeds when your endpoint answers with a `2xx` status. Anything else, or no
answer in time, is a failure, and Svix tries again on its retry schedule: right away, then
after 5 seconds, 5 minutes, 30 minutes, 2 hours, 5 hours, 10 hours and 10 hours more.
After the last attempt the delivery is marked failed. An endpoint that keeps failing for
days can be turned off; turn it back on with `superflow_update_webhook` and
`"active": true` once it works again.

So that this works well:

- Answer with `2xx` quickly and do slow work afterwards, for example in a queue.
- Expect the same event more than once. Drop duplicates by `id` (or the `svix-id` header).
- Expect events out of order. Use `created_at`, or read the current state from the API.

## Debugging

- `superflow_list_webhook_deliveries` lists the last 100 deliveries with the event, the
  status and the HTTP code your endpoint returned.
- `superflow_test_webhook` sends a `ping` you can watch arrive.
- `superflow_update_webhook` with `"active": false` pauses an endpoint without losing it;
  `superflow_delete_webhook` removes it (the assistant asks first).
