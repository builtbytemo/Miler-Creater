import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

/**
 * Creates an administrative Supabase client using the SERVICE ROLE key.
 * 
 * SECURITY WARNING:
 * 1. This client bypasses Row Level Security (RLS).
 * 2. It must NEVER be used on the client-side or in public client components.
 * 3. It is reserved exclusively for background workers, webhook handlers, and seed scripts.
 */
export function createAdminClient() {
  if (typeof window !== 'undefined') {
    throw new Error(
      'SECURITY VIOLATION: createAdminClient() was called in a browser environment! ' +
      'The Supabase service-role key must NEVER be exposed to client-side code.'
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    supabaseUrl.includes('your-project-ref') ||
    serviceRoleKey.includes('your-service-role-secret-key')
  ) {
    throw new Error(
      'Missing or placeholder NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables. ' +
      'Admin operations cannot be initialized.'
    );
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
