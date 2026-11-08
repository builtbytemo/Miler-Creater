# Miller Creator CLI

The CLI connects to the application's MCP endpoint. It lists the actions exposed by the running deployment and lets you inspect their input schemas and call them. It uses the same workspace restrictions and token scopes as other MCP clients.

From this project directory, run `npm install -g .` to install the `miler` command on your machine. Alternatively, use `npm run --silent cli --` in place of `miler` without a global installation. Node.js 20 or newer is required.

1. Start the app or use an HTTPS deployment. In the website's API Tokens settings, create a token with the scopes needed for your actions.
2. In your terminal, set `MILLER_URL` to the deployment origin and `MILLER_TOKEN` to that token. For local development, `MILLER_URL` can be `http://localhost:3000`. Keep the token private and avoid committing it to a file.
3. Run `npm run cli -- tools` to list actions, and `npm run cli -- describe search_tasks` to inspect one action's inputs.
4. Run an action with a JSON object, for example `npm run cli -- call search_tasks '{}'`. The CLI prints JSON and exits with a nonzero status when an action reports an error. JSON output can be piped into other tools; use `npm run --silent cli -- ...` to suppress npm's banner.

The URL may also end in `/api/mcp`. HTTPS is required except on localhost; redirects are rejected so the token is not forwarded to another host. Calls can change or permanently delete records, as described by the action's schema and the [MCP documentation](CLAUDE_SETUP.md).

## Common commands

```bash
miler tasks list --status todo
miler tasks create "Plan launch" --priority high --due 2026-11-09T12:00:00Z
miler tasks status TASK_ID done
miler content create --platform linkedin --title "Launch idea" --body "Draft copy"
miler calendar list --from 2026-11-09T00:00:00Z --to 2026-11-16T00:00:00Z
miler notifications list --unread
miler workspace summary
```

Use `miler --help` for the available commands. Dates must be ISO 8601 UTC timestamps ending in `Z`. Commands print JSON. `miler tasks delete TASK_ID --confirm-title "Exact title"` and `miler content delete CONTENT_ID --confirm-delete` permanently delete records. Use `miler tools`, `miler describe TOOL_NAME`, and `miler call TOOL_NAME '{"key":"value"}'` for the full action catalog and advanced arguments.

## Coverage

The CLI exposes the actions provided by the connected deployment, not every website feature. The current MCP catalog covers tasks, content, calendar, social planning profiles, workspace summaries, and notifications. Token administration is available separately with a user session, as described below. Email/password sign-in is supported for token administration; account registration, recovery, and Google sign-in are not yet available in the CLI. The website does not provide editing of existing recurrence rules or membership management, and the application does not publish to social networks.

## Managing API tokens

Token management requires a **Supabase user access token** for a signed-in account in `MILLER_USER_ACCESS_TOKEN`; an AI API token in `MILLER_TOKEN` cannot be used for this. The user token is short-lived and is validated by Supabase on every request. For email/password accounts, set `MILLER_SUPABASE_URL` and `MILLER_SUPABASE_ANON_KEY` to the project's public Supabase URL and anon key, and set `MILLER_EMAIL` to your account email. Then, in zsh or bash, run:

```bash
read -rs MILLER_PASSWORD
export MILLER_PASSWORD
export MILLER_USER_ACCESS_TOKEN="$(npm run --silent cli -- auth login)"
unset MILLER_PASSWORD
```

The password is read without echo and is not saved to shell history. The access token remains in your shell environment until unset. Run the sign-in steps again when it expires; automatic refresh and Google sign-in are not yet supported. Never commit credentials to a file.

```bash
npm run --silent cli -- tokens list
npm run --silent cli -- tokens create '{"input":{"name":"My CLI","scopes":["task:read","task:write"],"expiresInDays":30}}'
npm run --silent cli -- tokens revoke '{"tokenId":"YOUR-TOKEN-ID"}'
```

Add `"workspaceId":"YOUR-WORKSPACE-ID"` to the JSON object to select a workspace; otherwise the user's default workspace is used. Creation prints the new secret once, so treat the output as sensitive. Workspace membership and role restrictions are the same as in the website. This route requires a deployment containing the CLI changes.
