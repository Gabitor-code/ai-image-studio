import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'crypto';

// Keep in sync with the pricing cards in app/page.js and PLANS in
// app/api/checkout/route.js. Each plan has exactly two legitimate credit
// amounts: the normal one, and the Black Friday (Nov 23-30 2026) one.
// checkout/route.js is what actually DECIDES which one applies, using its
// own server clock at the moment of purchase - this webhook can run well
// after that decision was made (the customer takes time to pay), so it must
// not recompute Black Friday status itself. Instead it trusts
// `metadata.credits` only when it's exactly one of these two known-good
// numbers for the plan, never an arbitrary value.
const PLAN_CREDIT_OPTIONS = { starter: [200, 300], creator: [550, 800], pro: [1200, 1650] };

function validSignature(payload, signature, secret) {
  const values = Object.fromEntries(signature.split(',').map((entry) => entry.split('=')));
  const timestamp = values.t;
  const signatureV1 = values.v1;
  if (!timestamp || !signatureV1) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false;
  const expected = createHmac('sha256', secret).update(timestamp + '.' + payload).digest('hex');
  if (expected.length !== signatureV1.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureV1));
}

export async function POST(request) {
  const payload = await request.text();
  const signature = request.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret || !validSignature(payload, signature, secret)) return Response.json({ error: 'Invalid webhook signature.' }, { status: 400 });
  try {
    const event = JSON.parse(payload);
    if (event.type !== 'checkout.session.completed') return Response.json({ received: true });
    const session = event.data.object;
    if (session.payment_status !== 'paid') return Response.json({ received: true });
    const userId = session.metadata?.supabase_user_id;
    const planCreditOptions = PLAN_CREDIT_OPTIONS[session.metadata?.plan];
    const metadataCredits = Number(session.metadata?.credits);
    const credits = planCreditOptions && planCreditOptions.includes(metadataCredits) ? metadataCredits : undefined;
    if (!userId || !credits || !session.id) return Response.json({ error: 'Invalid credit purchase.' }, { status: 400 });
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await supabase.rpc('fulfill_stripe_credits', { p_session_id: session.id, p_user_id: userId, p_credits: credits });
    if (error) throw error;
    return Response.json({ received: true });
  } catch { return Response.json({ error: 'Unable to fulfill credits.' }, { status: 500 }); }
}
