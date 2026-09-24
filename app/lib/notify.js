// Sends an email alert via Resend (https://resend.com) whenever the keyword
// moderation filter (app/lib/moderation.js) blocks a prompt, so a real
// person can review borderline/false-positive cases and spot repeat
// offenders for the account enforcement described in the Terms of Service.
//
// Uses a plain fetch call rather than the Resend SDK, so no extra npm
// dependency is needed. Requires two environment variables to actually
// send anything:
//   RESEND_API_KEY   - from the Resend dashboard (free tier is enough for
//                      this volume of alerts)
//   MODERATION_ALERT_TO - the address that should receive these emails
// Optional:
//   MODERATION_ALERT_FROM - defaults to Resend's shared sandbox sender
//                      (onboarding@resend.dev), which works immediately
//                      with no domain setup, but can only send TO the email
//                      address on the Resend account itself. Once a sending
//                      domain is verified in Resend, set this to an address
//                      on that domain (e.g. alerts@gabitorai.com) to send to
//                      any address.
//
// If either required variable is missing, this silently no-ops (logged
// once) rather than breaking generation - moderation blocking itself does
// not depend on email working.
export async function sendModerationAlert({ userId, userEmail, category, term, prompt, negativePrompt }) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.MODERATION_ALERT_TO;
  const from = process.env.MODERATION_ALERT_FROM || 'Gabitor Moderation <onboarding@resend.dev>';
  if (!apiKey || !to) {
    console.warn('sendModerationAlert: RESEND_API_KEY or MODERATION_ALERT_TO not set, skipping email alert');
    return;
  }
  try {
    const subject = `Gabitor: blocked prompt (${category})`;
    const lines = [
      `A prompt was blocked by the content filter.`,
      ``,
      `User: ${userEmail || 'unknown'} (${userId})`,
      `Category: ${category}`,
      `Matched term: ${term}`,
      ``,
      `Prompt: ${prompt || '(none)'}`,
      negativePrompt ? `Negative prompt: ${negativePrompt}` : null,
      ``,
      `Time: ${new Date().toISOString()}`,
    ].filter(line => line !== null).join('\n');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text: lines }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error('sendModerationAlert: Resend request failed', { status: response.status, body: body.slice(0, 500) });
    }
  } catch (error) {
    console.error('sendModerationAlert: failed to send', error);
  }
}
