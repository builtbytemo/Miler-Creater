import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';

/**
 * Creates an isomorphic Supabase client for use in Client Components (browser-side).
 * Relies only on public environment variables and is subject to Row Level Security (RLS).
 */
export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (
    !supabaseUrl ||
    !supabaseAnonKey ||
    supabaseUrl.includes('your-project-ref') ||
    supabaseAnonKey.includes('your-anon-public-key')
  ) {
    throw new Error(
      'Supabase credentials are not configured or are set to placeholder values. ' +
      'Please supply valid NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your .env.local file.'
    );
  }

  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
}
