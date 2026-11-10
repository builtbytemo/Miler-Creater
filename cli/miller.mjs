#!/usr/bin/env node
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { parseFriendlyCommand } from './commands.mjs';
import { readCredentials, saveCredentials, deleteCredentials, promptSecret } from './credentials.mjs';
import { formatToolOutput, formatToolsList } from './format.mjs';

const DEFAULT_URL = 'https://miler-creater.vercel.app';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

const help = `Miller Creator CLI

Usage:
  miler login | logout
  miler tasks list [--search TEXT] [--status STATUS] [--priority PRIORITY] [--limit N]
  miler tasks show ID | create TITLE [--priority PRIORITY] [--due ISO_DATE]
  miler tasks update ID [--title TITLE] [--description TEXT] [--due ISO_DATE] [--stop-recurrence]
  miler tasks status ID STATUS | delete ID --confirm-title TITLE
  miler tasks overdue | depend ID DEPENDS_ON_ID | undepend DEP_ID
  miler content list [--search TEXT] [--status STATUS] [--platform PLATFORM]
  miler content show ID | scheduled --from ISO_DATE --to ISO_DATE
  miler content create --platform PLATFORM --title TITLE [--body TEXT]
  miler content update ID [--title TITLE] [--body TEXT] [--status STATUS]
  miler content delete ID --confirm-delete
  miler calendar list --from ISO_DATE --to ISO_DATE
  miler calendar create TITLE --start ISO_DATE [--end ISO_DATE]
  miler notifications list [--unread] | read ID | unread ID | dismiss ID | read-all
  miler reminders get | update [--lead-time MINUTES] [--email] [--in-app]
  miler accounts list | accounts create --platform PLATFORM --handle HANDLE [--name NAME]
  miler projects list | workspace summary
  npm run cli -- tools
  npm run cli -- describe <tool-name>
  npm run cli -- call <tool-name> [JSON-object]
  npm run cli -- tokens <list|create|revoke> [JSON-object]
  npm run --silent cli -- auth login

Use miler login to enter your private CLI username from the website.
Commands output human-readable tables by default. Add --json for raw JSON output.
MILLER_URL can select a different deployment, and MILLER_TOKEN can override
the stored credential. HTTPS is required except for localhost.
Examples:
  miler tasks list
  miler tasks list --json
  miler tools
  miler describe search_tasks
  npm run cli -- call search_tasks '{}'
`;

export function parseEndpoint(value) {
  if (!value) throw new Error('Set MILLER_URL to your Miller Creator deployment URL.');
  let url;
  try { url = new URL(value); } catch { throw new Error('MILLER_URL must be a valid URL.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) {
    throw new Error('MILLER_URL must use HTTPS (HTTP is allowed only on localhost), with no credentials, query, or fragment.');
  }
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/api/mcp';
  else if (url.pathname !== '/api/mcp' && url.pathname !== '/api/mcp/') throw new Error('MILLER_URL must be a deployment origin or end in /api/mcp.');
  return url;
}

const MCP_DISCOVER_PRIOR = {
  kind: 'modern',
  discover: {
    supportedVersions: ['2026-07-28'],
    capabilities: { tools: { listChanged: true } },
    serverInfo: { name: 'content-task-command-center', version: '1.1.0' },
  },
};

export async function loginWithCredential(token, env = process.env) {
  if (!/^ctc_live_[0-9a-f]{64}$/.test(token)) throw new Error('Invalid CLI username format.');
  const url = parseEndpoint(env.MILLER_URL || DEFAULT_URL);
  const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' } });
  const client = new Client({ name: 'miler-cli', version: '0.2.0' }, { versionNegotiation: { mode: 'auto' } });
  try {
    await client.connect(transport, { prior: MCP_DISCOVER_PRIOR });
    await client.listTools();
  } catch {
    throw new Error('Login failed. Check your CLI username, deployment URL, and network connection.');
  } finally { await client.close(); }
  await saveCredentials({ url: url.href, token }, env);
}

export async function run(args, env = process.env, output = console) {
  const [command, name, rawArgs, ...extra] = args;
  if (!command || command === '--help' || command === '-h' || command === 'help') { output.log(help); return 0; }
  if (command === 'login') {
    if (name || rawArgs || extra.length) throw new Error('Usage: miler login');
    await loginWithCredential(await promptSecret(), env);
    output.log('Signed in.');
    return 0;
  }
  if (command === 'logout') {
    if (name || rawArgs || extra.length) throw new Error('Usage: miler logout');
    await deleteCredentials(env);
    output.log('Signed out on this device.');
    return 0;
  }
  const friendly = parseFriendlyCommand(args);
  if (friendly) return run(['call', friendly.name, JSON.stringify(friendly.arguments), friendly.isJson ? '--json' : '--pretty'], env, output);
  if (command === 'auth') {
    if (name !== 'login' || rawArgs || extra.length) throw new Error('Usage: auth login');
    const supabaseUrl = parseEndpoint(env.MILLER_SUPABASE_URL);
    if (new URL(env.MILLER_SUPABASE_URL).pathname !== '/') throw new Error('MILLER_SUPABASE_URL must be a Supabase origin.');
    supabaseUrl.pathname = '/';
    if (!env.MILLER_SUPABASE_ANON_KEY || !env.MILLER_EMAIL || !env.MILLER_PASSWORD) throw new Error('Set MILLER_SUPABASE_ANON_KEY, MILLER_EMAIL, and MILLER_PASSWORD.');
    const authClient = createSupabaseClient(supabaseUrl.href, env.MILLER_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, redirect: 'error' }) },
    });
    const { data, error } = await authClient.auth.signInWithPassword({ email: env.MILLER_EMAIL, password: env.MILLER_PASSWORD });
    if (error || !data.session) throw new Error('Sign-in failed. Check your credentials and account status.');
    output.log(data.session.access_token);
    return 0;
  }
  if (command === 'tokens') {
    if (!['list', 'create', 'revoke'].includes(name) || extra.length) throw new Error('Usage: tokens <list|create|revoke> [JSON-object]');
    let params = {};
    try { params = rawArgs ? JSON.parse(rawArgs) : {}; } catch { throw new Error('Token arguments must be a JSON object.'); }
    if (!params || typeof params !== 'object' || Array.isArray(params) || 'action' in params) throw new Error('Token arguments must be a JSON object without an action field.');
    const endpoint = parseEndpoint(env.MILLER_URL);
    endpoint.pathname = '/api/cli/tokens';
    if (!env.MILLER_USER_ACCESS_TOKEN || /[\r\n]/.test(env.MILLER_USER_ACCESS_TOKEN)) throw new Error('Set MILLER_USER_ACCESS_TOKEN to a signed-in user access token.');
    const result = await fetch(endpoint, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.MILLER_USER_ACCESS_TOKEN}` }, body: JSON.stringify({ ...params, action: name }) });
    const payload = await result.json();
    output.log(JSON.stringify(payload, null, 2));
    return result.ok ? 0 : 1;
  }
  if (!['tools', 'describe', 'call'].includes(command) ||
      (command === 'tools' && ((name && name !== '--json') || rawArgs || extra.length)) ||
      (command === 'describe' && (!name || rawArgs || extra.length)) ||
      (command === 'call' && (!name || extra.length > 1 || (extra.length === 1 && extra[0] !== '--pretty' && extra[0] !== '--json')))) {
    throw new Error('Invalid command or arguments. Run with --help for usage.');
  }
  let toolArgs = {};
  if (command === 'call' && rawArgs !== undefined) {
    try { toolArgs = JSON.parse(rawArgs); } catch { throw new Error('Tool arguments must be a JSON object.'); }
    if (!toolArgs || typeof toolArgs !== 'object' || Array.isArray(toolArgs)) throw new Error('Tool arguments must be a JSON object.');
  }
  const stored = env.MILLER_TOKEN ? null : await readCredentials(env);
  const url = parseEndpoint(env.MILLER_URL || stored?.url || DEFAULT_URL);
  if (stored && url.href !== stored.url) throw new Error('Stored CLI username belongs to a different deployment. Run miler login with this MILLER_URL.');
  const token = env.MILLER_TOKEN || stored?.token;
  if (!token || /[\r\n]/.test(token)) throw new Error('Set MILLER_TOKEN to an API token from the website, or run miler login.');
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' },
  });
  const client = new Client({ name: 'miller-creator-cli', version: '0.1.0' }, { versionNegotiation: { mode: 'auto' } });
  try {
    await client.connect(transport, { prior: MCP_DISCOVER_PRIOR });
    if (command === 'call') {
      const result = await client.callTool({ name, arguments: toolArgs });
      if (result.isError) {
        output.log(JSON.stringify(result, null, 2));
        return 1;
      }
      const wantsJson = extra.includes('--json');
      if (wantsJson) {
        if (Array.isArray(result.content) && result.content[0]?.text) {
          try {
            const parsed = JSON.parse(result.content[0].text);
            output.log(JSON.stringify(parsed, null, 2));
          } catch {
            output.log(JSON.stringify(result, null, 2));
          }
        } else {
          output.log(JSON.stringify(result, null, 2));
        }
      } else {
        output.log(formatToolOutput(name, result));
      }
      return 0;
    }
    const tools = [];
    let cursor;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    if (command === 'describe') {
      const tool = tools.find(item => item.name === name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      output.log(JSON.stringify(tool, null, 2));
    } else {
      const wantsJson = name === '--json' || extra.includes('--json');
      output.log(formatToolsList(tools, { json: wantsJson }));
    }
    return 0;
  } finally { await client.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  run(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    const message = String(error.message || error);
    console.error(`Error: ${[process.env.MILLER_TOKEN, process.env.MILLER_USER_ACCESS_TOKEN, process.env.MILLER_PASSWORD].filter(Boolean).reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), message)}`);
    process.exitCode = 1;
  });
}
