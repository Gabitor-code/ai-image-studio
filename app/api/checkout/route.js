import { createClient } from '@supabase/supabase-js';

const PLANS = { starter: { credits: 50, priceEnv: 'STRIPE_STARTER_PRICE_ID' } };

export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!token || !supabaseUrl || !supabaseKey || !stripeKey) return Response.json({ error: 'Payments are not configured yet.' }, { status: 503 });
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return Response.json({ error: 'Please sign in to buy credits.' }, { status: 401 });
    const { plan } = await request.json();
    const selectedPlan = PLANS[plan];
    const priceId = selectedPlan && process.env[selectedPlan.priceEnv];
    if (!selectedPlan || !priceId) return Response.json({ error: 'This credit package is not available.' }, { status: 400 });
    const origin = new URL(request.url).origin;
    const params = new URLSearchParams({ mode: 'payment', 'line_items[0][price]': priceId, 'line_items[0][quantity]': '1', success_url: origin + '/?checkout=success', cancel_url: origin + '/?checkout=cancelled', locale: 'en', client_reference_id: user.id, 'metadata[plan]': plan, 'metadata[supabase_user_id]': user.id, 'metadata[credits]': String(selectedPlan.credits) });
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + stripeKey, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
    const session = await response.json();
    if (!response.ok || !session.url) return Response.json({ error: session.error?.message || 'Unable to start checkout.' }, { status: 502 });
    return Response.json({ url: session.url });
  } catch { return Response.json({ error: 'Unable to start checkout.' }, { status: 500 }); }
}
