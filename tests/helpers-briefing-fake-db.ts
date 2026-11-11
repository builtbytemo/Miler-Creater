/* eslint-disable @typescript-eslint/no-explicit-any */
/* Minimal in-memory Supabase fake for Daily Briefing tests. */
export interface FakeDb {
  tables: Record<string, Array<Record<string, any>>>;
  rpcs: Record<string, (args: any) => any>;
}

export function createFakeAdmin(db: FakeDb, opts: { users?: Record<string, { email?: string; email_confirmed_at?: string | null }> } = {}) {
  const uniques: Record<string, string[]> = {
    briefing_deliveries: ['user_id', 'channel', 'local_date'],
    telegram_webhook_updates: ['update_id'],
  };
  function from(table: string) {
    db.tables[table] ??= [];
    const rows = db.tables[table];
    const filters: Array<(r: any) => boolean> = [];
    let op: 'select' | 'upsert' | 'insert' | 'update' = 'select';
    let payload: any;
    let lim = Infinity;
    let rangeFrom: number | null = null;
    let rangeTo: number | null = null;
    const b: any = {
      select: () => b,
      eq: (c: string, v: any) => (filters.push((r) => r[c] === v), b),
      gt: (c: string, v: any) => (filters.push((r) => r[c] > v), b),
      neq: (c: string, v: any) => (filters.push((r) => r[c] !== v), b),
      in: (c: string, v: any[]) => (filters.push((r) => v.includes(r[c])), b),
      // PostgREST OR windows are a retrieval optimisation only; semantic filtering is done in code under test.
      or: () => b,
      order: () => b,
      limit: (n: number) => ((lim = n), b),
      range: (fromIdx: number, toIdx: number) => ((rangeFrom = fromIdx), (rangeTo = toIdx), b),
      maybeSingle: async () => ({ data: rows.filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }),
      upsert: (p: any) => ((op = 'upsert'), (payload = p), b),
      insert: (p: any) => ((op = 'insert'), (payload = p), b),
      update: (p: any) => ((op = 'update'), (payload = p), b),
      then: (resolve: any, reject: any) => {
        const run = () => {
          if (op === 'select') {
            const filtered = rows.filter((r) => filters.every((f) => f(r)));
            if (rangeFrom !== null && rangeTo !== null) {
              return { data: filtered.slice(rangeFrom, rangeTo + 1), error: null };
            }
            return { data: filtered.slice(0, lim), error: null };
          }
          if (op === 'update') {
            rows.filter((r) => filters.every((f) => f(r))).forEach((r) => Object.assign(r, payload));
            return { data: null, error: null };
          }
          const keys = uniques[table];
          const inserted: any[] = [];
          for (const p of [].concat(payload)) {
            const dup = keys && rows.some((r) => keys.every((k) => r[k] === (p as any)[k]));
            if (dup) {
              if (op === 'insert') return { data: null, error: { code: '23505' } };
              continue;
            }
            const row = { id: crypto.randomUUID(), ...(p as any) };
            rows.push(row);
            inserted.push(row);
          }
          return { data: inserted, error: null };
        };
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    return b;
  }
  return {
    from,
    rpc: async (name: string, args: any) => ({ data: db.rpcs[name]?.(args) ?? null, error: null }),
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: opts.users?.[id] ? { id, ...opts.users[id] } : null } }),
      },
    },
  } as any;
}
