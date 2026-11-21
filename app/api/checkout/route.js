import { createClient } from '@supabase/supabase-js';

// Black Friday 2026 promo window: Nov 23 00:00 - Nov 30 23:59:59,
// America/Chicago. Decided using THIS SERVER's clock (never the client's),
// at the moment the checkout session is created - this is what actually
// decides how many credits a purchase is worth. Keep in sync with
// app/page.js (display only) and PLAN_CREDIT_OPTIONS in
// app/api/stripe/webhook/route.js (which validates against both values).
function chicagoDateKey(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const hour = map.hour === '24' ? '00' : map.hour; // some ICU versions report midnight as "24"
  return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}:${map.second}`;
}
function isBlackFridayActive(date) {
  const key = chicagoDateKey(date);
  return key >= '2026-11-23T00:00:00' && key <= '2026-11-30T23:59:59';
}

// Keep in sync with the pricing cards in app/page.js and PLAN_CREDIT_OPTIONS in
// app/api/stripe/webhook/route.js.
const PLANS = {
  starter: { normalCredits: 200, bfCredits: 300, priceEnv: 'STRIPE_STARTER_PRICE_ID' },
  creator: { normalCredits: 550, bfCredits: 800, priceEnv: 'STRIPE_CREATOR_PRICE_ID' },
  pro: { normalCredits: 1200, bfCredits: 1650, priceEnv: 'STRIPE_PRO_PRICE_ID' }
};

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
    const credits = isBlackFridayActive(new Date()) ? selectedPlan.bfCredits : selectedPlan.normalCredits;
    const origin = new URL(request.url).origin;
    const params = new URLSearchParams({ mode: 'payment', 'line_items[0][price]': priceId, 'line_items[0][quantity]': '1', success_url: origin + '/?checkout=success', cancel_url: origin + '/?checkout=cancelled', locale: 'en', client_reference_id: user.id, 'metadata[plan]': plan, 'metadata[supabase_user_id]': user.id, 'metadata[credits]': String(credits) });
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + stripeKey, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
    const session = await response.json();
    if (!response.ok || !session.url) return Response.json({ error: session.error?.message || 'Unable to start checkout.' }, { status: 502 });
    return Response.json({ url: session.url });
  } catch { return Response.json({ error: 'Unable to start checkout.' }, { status: 500 }); }
}
