import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60;

async function readRunpodResponse(response) {
  const body = await response.text();
  if (!body) return { status: response.ok ? undefined : `HTTP_${response.status}` };
  try { return JSON.parse(body); }
  catch { return { status: `HTTP_${response.status}`, error: body.slice(0, 500) }; }
}

function extractVideo(value) {
  if (typeof value === 'string') {
    if (value.startsWith('data:video/')) return value;
    if (/^https?:\/\//i.test(value) && /\.(mp4|webm|mov)(\?|$)/i.test(value)) return value;
    if (value.length > 100000) return value;
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const key of ['video_url', 'videoUrl', 'video', 'url', 'output', 'body', 'data']) {
    const found = extractVideo(value[key]);
    if (found) return found;
  }
  return null;
}

export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const apiKey = process.env.RUNPOD_API_KEY, endpoint = process.env.RUNPOD_ENDPOINT_ID;
    const imageEndpoint = process.env.RUNPOD_IMAGE_ENDPOINT_ID || endpoint;
    const videoEndpoint = process.env.RUNPOD_VIDEO_ENDPOINT_ID;
    const editEndpoint = process.env.RUNPOD_EDIT_ENDPOINT_ID;
    if (!token || !url || !anon) return Response.json({ error: 'Please sign in to create an image.' }, { status: 401 });
    const supabase = createClient(url, anon);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return Response.json({ error: 'Your sign-in session has expired. Please sign in again.' }, { status: 401 });
    const { prompt, style, resolution = '768', quality = 'high', aspectRatio = '1:1', referenceStrength = 0.3, duration = 5, motion = 'medium', negativePrompt = '', seed = -1, referenceImage, workflowMode = referenceImage ? 'edit' : 'image' } = await request.json();
    if (!apiKey || (workflowMode === 'image' && !imageEndpoint) || (workflowMode === 'edit' && !editEndpoint) || (workflowMode === 'video' && !videoEndpoint)) return Response.json({ error: 'This workflow is not configured yet.' }, { status: 503 });
    if (!prompt || typeof prompt !== 'string' || prompt.length > 1000) return Response.json({ error: 'Please provide an image description up to 1,000 characters.' }, { status: 400 });
    const finalPrompt = `${style && style !== 'None' ? `${style} style, ` : ''}${referenceImage ? 'Keep the original subject identity and clothing recognizable, while clearly transforming the requested atmosphere, lighting, and environment. ' : ''}${prompt}`;
    const size = ['512', '768', '1024'].includes(String(resolution)) ? Number(resolution) : 768;
    const ratio = aspectRatio === '16:9' ? [size, Math.round(size * 9 / 16)] : aspectRatio === '9:16' ? [Math.round(size * 9 / 16), size] : [size, size];
    const [width, height] = ratio;
    const steps = quality === 'standard' ? 16 : 28;
    const safeSeed = Number.isFinite(Number(seed)) && Number(seed) >= 0 ? Number(seed) : Math.floor(Math.random() * 999999999999999);
    const motionGuidance = motion === 'low' ? 3.5 : motion === 'high' ? 6.5 : 5;
    const db = createClient(url, anon, { global: { headers: { Authorization: 'Bearer ' + token } } });
    const { error: reserveError } = await db.rpc('reserve_generation_slot');
    if (reserveError) return Response.json({ error: reserveError.message.includes('INSUFFICIENT_CREDITS') ? 'You do not have enough credits to generate an image.' : 'Unable to verify your credits right now.' }, { status: 429 });
    const workflow = {
      '6': { inputs: { text: finalPrompt, clip: ['30', 1] }, class_type: 'CLIPTextEncode' },
      '8': { inputs: { samples: ['31', 0], vae: ['30', 2] }, class_type: 'VAEDecode' },
      '9': { inputs: { filename_prefix: 'Gabitor', images: ['8', 0] }, class_type: 'SaveImage' },
      '27': { inputs: { width, height, batch_size: 1 }, class_type: 'EmptySD3LatentImage' },
      '30': { inputs: { ckpt_name: 'flux1-dev-fp8.safetensors' }, class_type: 'CheckpointLoaderSimple' },
      // Keep reference clothing/product details stable; only the requested scene should change.
      '31': { inputs: { seed: safeSeed, steps, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: referenceImage ? Math.min(0.95, Math.max(0.05, Number(referenceStrength))) : 1, model: ['30', 0], positive: ['35', 0], negative: ['33', 0], latent_image: referenceImage ? ['37', 0] : ['27', 0] }, class_type: 'KSampler' },
      '33': { inputs: { text: negativePrompt, clip: ['30', 1] }, class_type: 'CLIPTextEncode' },
      '35': { inputs: { guidance: 3.5, conditioning: ['6', 0] }, class_type: 'FluxGuidance' }
    };
    const imagePayload = referenceImage ? [{ name: 'reference.png', image: referenceImage.replace(/^data:image\/[^;]+;base64,/, '') }] : undefined;
    if (referenceImage) { workflow['36'] = { inputs: { image: 'reference.png', upload: 'image' }, class_type: 'LoadImage' }; workflow['37'] = { inputs: { pixels: ['36', 0], vae: ['30', 2] }, class_type: 'VAEEncode' }; }
    let referenceUrl = referenceImage;
    if (referenceImage?.startsWith('data:image/')) {
      const match = referenceImage.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (!match) return Response.json({ error: 'The reference image format is invalid.' }, { status: 400 });
      const ext = match[1].split('/')[1].replace('jpeg', 'jpg');
      const path = `${user.id}/${Date.now()}.${ext}`;
      const bytes = Buffer.from(match[2], 'base64');
      const { error: uploadError } = await db.storage.from('references').upload(path, bytes, { contentType: match[1], upsert: false });
      if (uploadError) return Response.json({ error: 'Reference image storage is not configured yet. Please create a public “references” bucket in Supabase.' }, { status: 503 });
      referenceUrl = db.storage.from('references').getPublicUrl(path).data.publicUrl;
    }
    if (workflowMode === 'video') {
      if (!referenceImage) return Response.json({ error: 'Please upload an image for image-to-video generation.' }, { status: 400 });
      const [videoWidth, videoHeight] = aspectRatio === '16:9' ? [832, 480] : aspectRatio === '9:16' ? [480, 832] : [640, 640];
      const videoInput = {
        prompt: finalPrompt,
        negative_prompt: 'blurry, low quality, distorted, flicker, warped details',
        input_reference: referenceImage.replace(/^data:image\/[^;]+;base64,/, ''),
        width: videoWidth,
        height: videoHeight,
        seconds: [5, 8, 10].includes(Number(duration)) ? Number(duration) : 5,
        num_inference_steps: 30,
        guidance_scale: motionGuidance,
        seed: Number(seed) >= 0 ? Number(seed) : -1
      };
      const videoResponse = await fetch(`https://api.runpod.ai/v2/${videoEndpoint}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey }, body: JSON.stringify({ input: { route: '/v1/videos', body: videoInput } }) });
      const videoData = await readRunpodResponse(videoResponse);
      if (videoResponse.ok && videoData.id && (videoData.status === 'IN_QUEUE' || videoData.status === 'IN_PROGRESS')) {
        return Response.json({ pending: true, jobId: videoData.id, status: videoData.status }, { status: 202 });
      }
      const video = extractVideo(videoData.output) || extractVideo(videoData.video);
      if (!videoResponse.ok || videoData.status === 'FAILED' || !video) return Response.json({ error: `RunPod video generation failed: ${videoData.error || videoData.output?.error || videoData.status || 'no video returned'}` }, { status: 502 });
      const { data: creditData, error: creditError } = await db.rpc('complete_generation_credit');
      if (creditError) return Response.json({ error: 'Your video was created, but we could not finalize the credit.' }, { status: 500 });
      return Response.json({ video: video.startsWith('data:') ? video : `data:video/mp4;base64,${video}`, remainingCredits: creditData?.remaining_credits });
    }
    // Qwen Hub endpoints use a simple {prompt,image_url} contract. Keep this
    // provider switch explicit so an endpoint ID can be any generated UUID.
    const editProvider = process.env.RUNPOD_EDIT_PROVIDER || '';
    const officialEditEndpoint = editProvider === 'qwen' || editProvider === 'vllm-omni'
      || editEndpoint === 'qwen-image-edit' || editEndpoint === 'qwen-image-edit-2511';
    const vllmOmniEditEndpoint = editProvider === 'vllm-omni';
    const requestInput = referenceImage
      ? officialEditEndpoint
        ? (vllmOmniEditEndpoint
          ? { route: '/v1/images/edits', body: { prompt: finalPrompt, image_b64: [referenceImage.replace(/^data:image\/[^;]+;base64,/, '')] } }
          : editEndpoint === 'qwen-image-edit-2511'
          ? { prompt: finalPrompt, images: [referenceUrl], seed: safeSeed, size: `${width}*${height}`, output_format: 'png' }
          : { prompt: finalPrompt, image_url: referenceUrl })
        : { workflow, images: imagePayload }
      : { workflow, ...(imagePayload ? { images: imagePayload } : {}) };
    const runpodEndpoint = workflowMode === 'edit' ? editEndpoint : imageEndpoint;
    const runpodHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey };
    const runPath = editProvider === 'vllm-omni' ? 'run' : 'runsync';
    const response = await fetch(`https://api.runpod.ai/v2/${runpodEndpoint}/${runPath}`, { method: 'POST', headers: runpodHeaders, body: JSON.stringify({ input: requestInput }) });
    let data = await readRunpodResponse(response);
    // A busy endpoint can return IN_QUEUE/IN_PROGRESS from runsync before the
    // worker has produced output. Poll the job instead of reporting a false
    // image-edit failure to the user.
    if (response.ok && (data.status === 'IN_QUEUE' || data.status === 'IN_PROGRESS') && data.id) {
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline && (data.status === 'IN_QUEUE' || data.status === 'IN_PROGRESS')) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const statusResponse = await fetch(`https://api.runpod.ai/v2/${runpodEndpoint}/status/${data.id}`, { headers: { Authorization: 'Bearer ' + apiKey } });
        data = await readRunpodResponse(statusResponse);
      }
    }
    const first = data.output?.images?.[0] || data.output?.data?.[0] || data.output?.body?.data?.[0];
    const image = first?.data || first?.b64_json || first?.image_url || first?.url || data.output?.message || data.output?.image || data.output?.image_url || data.output?.url || data.output?.image_base64 || data.output?.body?.image;
    if (!response.ok || data.status === 'FAILED' || !image) {
      const workerError = data.error || data.output?.error || data.output?.message || data.output?.status || data.status;
      console.error('generate2: RunPod edit response did not contain an image', {
        httpStatus: response.status,
        runpodStatus: data.status,
        error: workerError,
        outputKeys: data.output && typeof data.output === 'object' ? Object.keys(data.output) : [],
      });
      return Response.json({ error: workerError ? `RunPod image edit failed: ${workerError}` : 'RunPod did not return an image. Your credit was not used.' }, { status: 502 });
    }
    const { data: creditData, error: creditError } = await db.rpc('complete_generation_credit');
    if (creditError) return Response.json({ error: 'Your image was created, but we could not finalize the credit.' }, { status: 500 });
    return Response.json({ image: typeof image === 'string' && image.startsWith('data:') ? image : typeof image === 'string' && image.startsWith('http') ? image : `data:image/png;base64,${image}`, remainingCredits: creditData?.remaining_credits });
  } catch { return Response.json({ error: 'Unable to generate an image right now. Your credit was not used.' }, { status: 500 }); }
}
