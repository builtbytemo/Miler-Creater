import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';

/**
 * Creates an isomorphic Supabase client for use in Client Components (browser-side).
 * Relies only on public environment variables and is subject to Row Level Security (RLS).
 */
export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Please verify your .env.local file configuration.'
    );
  }

  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
}
