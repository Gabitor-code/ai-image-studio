import { createClient } from '@supabase/supabase-js';

const prohibitedPromptPatterns = [
  /\b(nsfw|nude|nudity|naked|porn|porno|pornographic|sex|sexual|erotic|fetish|lingerie|topless|breast|nipple|genital|penis|vagina|anal|orgasm|masturbat|incest|rape|onlyfans)\b/i,
  /\b(child|children|minor|underage|teen|teenager|schoolgirl|schoolboy|young girl|young boy|loli|lolita)\b/i,
  /\b(non[- ]?consensual|intimate deepfake|sexual deepfake)\b/i
];

function isProhibitedPrompt(prompt) {
  return prohibitedPromptPatterns.some((pattern) => pattern.test(prompt));
}

function creditErrorMessage(message = '') {
  if (message.includes('INSUFFICIENT_CREDITS')) return 'You do not have enough credits to generate an image.';
  if (message.includes('RATE_LIMITED')) return 'Please wait 10 seconds before starting another generation.';
  if (message.includes('PROFILE_NOT_FOUND')) return 'Your account credits are still being set up. Please sign out and sign in again.';
  return 'Unable to verify your credits right now. Please try again.';
}

export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const apiKey = process.env.RUNPOD_API_KEY;
    const endpointId = process.env.RUNPOD_ENDPOINT_ID;
    if (!token || !supabaseUrl || !supabaseKey) return Response.json({ error: 'Please sign in to create an image.' }, { status: 401 });
    if (!apiKey || !endpointId) return Response.json({ error: 'Image generation is not configured yet.' }, { status: 503 });

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return Response.json({ error: 'Your sign-in session has expired. Please sign in again.' }, { status: 401 });

    const { prompt } = await request.json();
    if (!prompt || typeof prompt !== 'string' || prompt.length > 1000) return Response.json({ error: 'Please provide an image description up to 1,000 characters.' }, { status: 400 });
    if (isProhibitedPrompt(prompt)) return Response.json({ error: 'This request is not permitted. Gabitor does not allow sexual, nude, adult, minor-related, or non-consensual content.' }, { status: 400 });

    const userSupabase = createClient(supabaseUrl, supabaseKey, { global: { headers: { Authorization: 'Bearer ' + token } } });
    const { error: reservationError } = await userSupabase.rpc('reserve_generation_slot');
    if (reservationError) return Response.json({ error: creditErrorMessage(reservationError.message) }, { status: 429 });

    const workflow = {
      '6': { inputs: { text: prompt, clip: ['30', 1] }, class_type: 'CLIPTextEncode' },
      '8': { inputs: { samples: ['31', 0], vae: ['30', 2] }, class_type: 'VAEDecode' },
      '9': { inputs: { filename_prefix: 'Gabitor', images: ['8', 0] }, class_type: 'SaveImage' },
      '27': { inputs: { width: 768, height: 768, batch_size: 1 }, class_type: 'EmptySD3LatentImage' },
      '30': { inputs: { ckpt_name: 'flux1-dev-fp8.safetensors' }, class_type: 'CheckpointLoaderSimple' },
      '31': { inputs: { seed: Math.floor(Math.random() * 999999999999999), steps: 12, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1, model: ['30', 0], positive: ['35', 0], negative: ['33', 0], latent_image: ['27', 0] }, class_type: 'KSampler' },
      '33': { inputs: { text: '', clip: ['30', 1] }, class_type: 'CLIPTextEncode' },
      '35': { inputs: { guidance: 3.5, conditioning: ['6', 0] }, class_type: 'FluxGuidance' }
    };

    const response = await fetch('https://api.runpod.ai/v2/' + endpointId + '/runsync', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey }, body: JSON.stringify({ input: { workflow } }) });
    const data = await response.json();
    if (!response.ok || data.status === 'FAILED') return Response.json({ error: data.error || data.output?.error || 'Generation failed. Your credit was not used.' }, { status: 502 });
    if (!data.output?.message) return Response.json({ error: 'RunPod did not return an image. Your credit was not used.' }, { status: 502 });

    const { data: creditData, error: creditError } = await userSupabase.rpc('complete_generation_credit');
    if (creditError) return Response.json({ error: 'Your image was created, but we could not finalize the credit. Please contact support before trying again.' }, { status: 500 });
    return Response.json({ image: data.output.message, remainingCredits: creditData?.remaining_credits });
  } catch {
    return Response.json({ error: 'Unable to generate an image right now. Your credit was not used.' }, { status: 500 });
  }
}
