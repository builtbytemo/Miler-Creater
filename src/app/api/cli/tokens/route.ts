import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/types/database';
import { resolveAuthorizedWorkspace } from '@/lib/auth/workspace';
import { createAiToken, listWorkspaceTokens, revokeAiToken } from '@/lib/mcp/token-service';
import { createAiTokenSchema, revokeAiTokenSchema } from '@/lib/validation/ai-token';

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), workspaceId: z.string().uuid().optional() }).strict(),
  z.object({ action: z.literal('create'), workspaceId: z.string().uuid().optional(), input: createAiTokenSchema }).strict(),
  z.object({ action: z.literal('revoke'), workspaceId: z.string().uuid().optional(), tokenId: revokeAiTokenSchema.shape.tokenId }).strict(),
]);

const response = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

export async function POST(request: Request) {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '');
  if (!match) return response({ error: 'A user access token is required.' }, 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response({ error: 'Authentication is not configured.' }, 503);
  const supabase = createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${match[1]}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.auth.getUser(match[1]);
  if (error || !data.user) return response({ error: 'Invalid or expired user access token.' }, 401);
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 8192) return response({ error: 'Request is too large.' }, 413);
    body = JSON.parse(text);
  } catch { return response({ error: 'Invalid JSON.' }, 400); }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return response({ error: 'Invalid request.', details: parsed.error.issues.map(i => i.message) }, 400);
  const input = parsed.data;
  const workspace = await resolveAuthorizedWorkspace(supabase, data.user.id, input.workspaceId);
  if (!workspace.workspaceId) return response({ error: 'Workspace access denied.' }, 403);
  try {
    if (input.action === 'list') return response({ data: await listWorkspaceTokens(supabase, workspace.workspaceId, data.user.id) });
    if (input.action === 'create') return response({ data: await createAiToken(supabase, { workspaceId: workspace.workspaceId, userId: data.user.id, ...input.input, expiresInDays: input.input.expiresInDays ?? undefined }) });
    return response({ data: await revokeAiToken(supabase, workspace.workspaceId, input.tokenId, data.user.id) });
  } catch {
    return response({ error: 'Token operation failed. Check your workspace role and token details.' }, 403);
  }
}
