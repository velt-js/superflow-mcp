# Example prompts

Things to ask your assistant once `superflow-mcp` is connected. Names, domains,
emails and comment numbers all work: the server resolves them.

## The basics

1. Show me open comments on usesuperflow.ai/pricing.
2. How many unresolved comments per page on the Acme project?
3. Which comments from guests have had no reply from us in 3 days?
4. Resolve everything tagged `copy` on the homepage.
5. Assign all high priority mobile comments on Acme to Jen.
6. What did the agents find in the last run? Which ones look like false positives?
7. Reply to comment 4821: fixed, please check.
8. Draft a client update for Acme covering what was closed this week.

## Finding things

- What came in on Acme since yesterday?
- Find every comment that mentions checkout, across all projects.
- Show me comment #4821 on Acme with its replies.
- Which pages on Acme have no comments yet?
- What is assigned to me that is still open?
- Show me mobile comments on the pricing page.

## Counting and reporting

- How many comments did we resolve last week, by assignee?
- What is our average time to resolve on Acme, week by week?
- What is our median time to first reply on client comments?
- Which of my sites has the most open comments?
- Export every resolved comment on Acme from this week as markdown.

## Changing things

The assistant asks before it writes. Bulk changes are a dry run first.

- Mark 4821 on Acme as resolved with a note saying the copy was updated.
- Reopen 4821, the fix did not work on mobile.
- Set every open comment tagged `legal` on Acme to high priority.
- Leave a comment on https://acme.com/pricing saying the price table is cut off on mobile.
- Attach https://files.example.com/fix.png to comment 4821.

## Running the workspace

These use the admin tools. Invites send real email, and deletes, removals and merges
show a preview first.

- Create a project for client Northwind at northwind-dental.com on Webflow, invite dana@northwind-dental.com, and give me the install snippet.
- Is the Superflow snippet live on acme.com yet?
- Turn on guest comments for Acme, but make guests sign in.
- Add staging.acme.com as an extra domain for Acme.
- Invite jen@agency.com to the team.
- Who are the guests on Acme? Remove the one from the old agency.
- Remove Jen from the workspace and hand her open comments to Rakesh.
- Add an "In review" status to Acme, between Open and Resolved.
- Merge the tag "Copy text" into "copy".
- How many member seats do we have left?
- Which agent used the most AI credits this month?
- What did the API change on Acme in the last week, and who did it?
- Switch my email digest to weekly and only email me about my own threads.
- Archive the Acme project, we are done with it.

## Prompts that ship with the server

Your client may show these as slash commands or templates.

- `triage`: group open comments by page and propose priority and assignee.
- `stale_threads`: threads waiting on your team for N days, with one nudge per assignee.
- `client_update`: what closed, what is open, what we need from the client.
- `agent_findings_review`: review an agent run and flag likely false positives.
- `find_duplicates`: near-duplicate comments and which to keep.
- `launch_checklist`: install status, guests, open comments by priority, and pages nobody has reviewed.
- `onboard_client`: create a project for a new client, invite their reviewers, hand over the install snippet and check it.
