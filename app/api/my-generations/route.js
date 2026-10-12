import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// The signed-in user's own recent generations (read-only, RLS: auth.uid() = user_id).
// Used by the Gabor AI Team bridge to recover an image that finished on the server
// after the browser lost the long-running /api/generate2 connection.
export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!token || !url || !anon) return Response.json({ error: 'Please sign in.' }, { status: 401 });
    const { data: { user }, error: authError } = await createClient(url, anon).auth.getUser(token);
    if (authError || !user) return Response.json({ error: 'Your sign-in session has expired. Please sign in again.' }, { status: 401 });
    const sinceParam = new URL(request.url).searchParams.get('since');
    const since = sinceParam && !Number.isNaN(Date.parse(sinceParam)) ? new Date(sinceParam).toISOString() : new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const db = createClient(url, anon, { global: { headers: { Authorization: 'Bearer ' + token } } });
    const { data, error } = await db.from('generations')
      .select('created_at, prompt, media_type, status, output_path')
      .eq('user_id', user.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) return Response.json({ error: 'Unable to load your creations right now.' }, { status: 500 });
    return Response.json({ items: data || [] }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Unable to load your creations right now.' }, { status: 500 });
  }
}
