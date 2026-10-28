import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const { origin } = new URL(request.url);
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Continue redirect
  }
  return NextResponse.redirect(`${origin}/auth/sign-in`, { status: 303 });
}

export async function GET(request: NextRequest) {
  const { origin } = new URL(request.url);
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Continue redirect
  }
  return NextResponse.redirect(`${origin}/auth/sign-in`, { status: 303 });
}
