# Control Command Center from Claude

## Connect

1. Run this version of the app on a public HTTPS deployment. Claude's remote connector runs in Anthropic's infrastructure and cannot reach `http://localhost:3000`.
2. Open the app's **API Tokens** settings page. The **Connect Claude** section shows the deployment's `/api/mcp` URL.
3. In Claude, open **Settings → Connectors → Add custom connector**, enter a name and that URL, and connect.
4. Sign in to Command Center and approve the workspace permissions. Select all four scopes for all supported controls. Never paste a Supabase secret key into Claude.
5. Enable the connector in the Claude conversation and ask for the work you want done. If already connected, refresh/reconnect to discover the expanded tool list.

Official setup: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp

OAuth registration, consent, PKCE, and token revocation already exist in this app. Bearer-token clients may alternatively use an app-generated token in the Authorization header. Connecting a Claude account is a user sign-in step; code changes do not connect it automatically.

## Supported controls (28 tools)

- Tasks: search (with pagination and date/project filters), inspect, create tasks and subtasks, edit, complete/cancel, reschedule, and delete. Add/remove dependency links. New tasks can repeat using recurrence settings.
- Content: search with pagination and filters, inspect, create ideas/drafts/scheduled content, edit copy, tags, media references, target references, notes and account/project associations, archive/unarchive, reschedule, and delete. New content can repeat.
- Calendar: query scheduled tasks, content and deadlines over an ordered range of up to 120 days; create Calendar entries using `create_calendar_entry` (or `created_from: "calendar"` on task/content creation). Otherwise omit that field to place new items in Tasks/Content, which appear in the calendar's assignment panel when scheduled.
- Workspace: read operational summaries and project IDs.
- Social accounts: list profiles and add planning profiles.
- Notifications: list, mark read/unread, dismiss, mark all read, and read/update reminder preferences.

Calendar-origin creation requires migration `20261105000001_calendar_creation_source.sql` to be applied. All other new tools use the existing schema.

## Examples

- “Show my schedule tomorrow, and tell me which tasks are overdue.”
- “Create a task to prepare the launch, with subtasks for research, copy, and design.”
- “Make the design task depend on the research task.”
- “Put a two-hour planning session on my calendar Friday at 10 AM Cairo time.”
- “Create three LinkedIn ideas in Content, then schedule the first for Monday.”
- “Archive that draft and mark my launch notifications as read.”
- “Remind me 30 minutes before tasks and content are due.”

## Permissions and limits

Every call is checked against the token's scopes and forced to its workspace and user. Notification preferences and notification mutations always use the token owner's user ID. Cross-domain notifications/calendar operations require both task and content scopes for that operation.

Deletion is immediate and permanent, not a queued in-app approval. The tools describe deletion as requiring an explicit user request. Task deletion additionally checks the exact current title; content deletion requires `confirm_delete: true`. These arguments guard against accidental targets; they are not independent proof of human approval. Claude's tool approval controls determine when it asks before executing. Revoke the connection or token in settings to withdraw access.

The integration manages app records, not the browser UI. It does not expose credentials, token administration, membership management, arbitrary SQL, social publishing, or functionality the app itself does not implement. Social account profiles do not log in to a platform. Existing recurrence rules cannot be edited through this tool catalog; recurrence is configured at creation.

Local unit/transport tests cover OAuth, tool discovery, scopes, schemas, and trusted identities. A live connection still requires deploying this version and completing sign-in in Claude.

## Diagnose missing actions

The server identifies as version `1.1.0` and advertises 28 tools. Its `tools/list` response includes a dedicated `create_calendar_entry` action, plus a `created_from` property on both `create_task` and `create_content_item`. A successful Git push alone does not prove that a given Claude connector points to that deployment.

If Claude cannot see these:

1. Check the connector URL matches the updated deployment and ends in `/api/mcp`.
2. Refresh/reconnect the connector in Claude, then start a new conversation with that connector enabled.
3. Ask Claude to use `create_calendar_entry` with the requested start and end timestamps. Do not substitute an ordinary task when the calendar action is missing; report the unavailable action instead.
4. If it still fails, record the connector URL and exact error (without sharing tokens) so the running endpoint can be checked.

The calendar entry is stored as a task internally with `created_from=calendar`; the UI keeps it out of Tasks and the left assignment list. Adding a time alone does not set this placement.
