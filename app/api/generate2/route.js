import { createClient } from '@supabase/supabase-js';
 
export const maxDuration = 60;
 
// Shared by every provider below (RunPod, Alibaba Cloud Model Studio,
// Replicate) - they all return plain JSON bodies, and this keeps a bad/
// non-JSON error body from throwing before we get a chance to report it.
async function readJsonResponse(response) {
  const body = await response.text();
  if (!body) return { status: response.ok ? undefined : `HTTP_${response.status}` };
  try { return JSON.parse(body); }
  catch { return { status: `HTTP_${response.status}`, error: body.slice(0, 500) }; }
}
 
export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const apiKey = process.env.RUNPOD_API_KEY;
    const editEndpoint = process.env.RUNPOD_EDIT_ENDPOINT_ID;
    // Image generation (workflowMode 'image') moved off RunPod/Flux onto
    // Alibaba Cloud Model Studio's Qwen-Image-3.0, and video generation moved
    // off fal.ai's Seedance 2.5 onto a two-tier setup: Alibaba Cloud's Wan
    // image-to-video for the "Standard" tier, and Kling v2.5 Turbo Pro
    // (via Replicate) for the "Cinematic" tier. RunPod is now only used for
    // the reference-image "edit" workflow.
    const dashscopeKey = process.env.DASHSCOPE_API_KEY;
    const dashscopeBase = process.env.DASHSCOPE_BASE_URL || 'https://dashscope-intl.aliyuncs.com';
    const replicateToken = process.env.REPLICATE_API_TOKEN;
    if (!token || !url || !anon) return Response.json({ error: 'Please sign in to create an image.' }, { status: 401 });
    const supabase = createClient(url, anon);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return Response.json({ error: 'Your sign-in session has expired. Please sign in again.' }, { status: 401 });
    const { prompt, style, resolution = '768', quality = 'high', videoResolution = '720p', videoTier = 'standard', aspectRatio = '1:1', referenceStrength = 0.3, duration = 5, motion = 'medium', negativePrompt = '', seed = -1, referenceImage, workflowMode = referenceImage ? 'edit' : 'image' } = await request.json();
    const videoTierValue = videoTier === 'cinematic' ? 'cinematic' : 'standard';
    if (
      (workflowMode === 'image' && !dashscopeKey) ||
      (workflowMode === 'edit' && (!editEndpoint || !apiKey)) ||
      (workflowMode === 'video' && (videoTierValue === 'cinematic' ? !replicateToken : !dashscopeKey))
    ) return Response.json({ error: 'This workflow is not configured yet.' }, { status: 503 });
    if (!prompt || typeof prompt !== 'string' || prompt.length > 1000) return Response.json({ error: 'Please provide an image description up to 1,000 characters.' }, { status: 400 });
    const finalPrompt = `${style && style !== 'None' ? `${style} style, ` : ''}${referenceImage ? 'Keep the original subject identity and clothing recognizable, while clearly transforming the requested atmosphere, lighting, and environment. ' : ''}${prompt}`;
    const size = ['512', '768', '1024'].includes(String(resolution)) ? Number(resolution) : 768;
    const ratio = aspectRatio === '16:9' ? [size, Math.round(size * 9 / 16)] : aspectRatio === '9:16' ? [Math.round(size * 9 / 16), size] : [size, size];
    const [width, height] = ratio;
    const steps = quality === 'standard' ? 16 : 28;
    const safeSeed = Number.isFinite(Number(seed)) && Number(seed) >= 0 ? Number(seed) : Math.floor(Math.random() * 999999999999999);
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
      if (uploadError) return Response.json({ error: 'Reference image storage is not configured yet. Please create a public "references" bucket in Supabase.' }, { status: 503 });
      referenceUrl = db.storage.from('references').getPublicUrl(path).data.publicUrl;
    }
    if (workflowMode === 'image') {
      // Qwen-Image-3.0 (Alibaba Cloud Model Studio) - synchronous text-to-image.
      // No polling needed: the image URL comes back directly in the response
      // (valid for 24h, same as the video providers below - it's re-hosted
      // on Supabase/downloaded by the user well before that).
      const imageModel = process.env.DASHSCOPE_IMAGE_MODEL || 'qwen-image-3.0-pro';
      const qwenBody = {
        model: imageModel,
        input: { messages: [{ role: 'user', content: [{ text: finalPrompt }] }] },
        parameters: { prompt_extend: true, n: 1, size: `${width}*${height}`, seed: safeSeed, watermark: false, ...(negativePrompt ? { negative_prompt: negativePrompt } : {}) }
      };
      const qwenResponse = await fetch(`${dashscopeBase}/api/v1/services/aigc/multimodal-generation/generation`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + dashscopeKey }, body: JSON.stringify(qwenBody) });
      const qwenData = await readJsonResponse(qwenResponse);
      const qwenImageUrl = qwenData.output?.choices?.[0]?.message?.content?.find(item => item?.image)?.image;
      if (!qwenResponse.ok || !qwenImageUrl) {
        const detail = qwenData.message || qwenData.error || qwenData.code || `HTTP ${qwenResponse.status}`;
        console.error('generate2: Qwen-Image request failed', { httpStatus: qwenResponse.status, detail });
        return Response.json({ error: `Image generation failed: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` }, { status: 502 });
      }
      const { data: qwenCreditData, error: qwenCreditError } = await db.rpc('complete_generation_credit');
      if (qwenCreditError) {
        console.error('generate2: complete_generation_credit failed', qwenCreditError);
        return Response.json({ image: qwenImageUrl, creditWarning: 'Your image is ready, but we could not finalize the credit for it.' });
      }
      return Response.json({ image: qwenImageUrl, remainingCredits: qwenCreditData?.remaining_credits });
    }
    if (workflowMode === 'video') {
      if (!referenceImage) return Response.json({ error: 'Please upload an image for image-to-video generation.' }, { status: 400 });
      const videoSeconds = [5, 8, 10].includes(Number(duration)) ? Number(duration) : 5;
      // "Standard" (Alibaba Wan) supports 480p/720p; "Cinematic" (Kling on
      // Replicate) picks its own output resolution (up to 1080p) - it has no
      // resolution input, so this value is only used for the Standard tier.
      const resolutionValue = ['480p', '720p'].includes(videoResolution) ? videoResolution : '720p';
      const motionPhrase = motion === 'low' ? 'Keep the motion slow, gentle, and minimal.' : motion === 'high' ? 'Make the motion fast, dynamic, and energetic.' : 'Keep the motion natural and moderate.';
      const videoPrompt = `${finalPrompt} ${motionPhrase}${negativePrompt ? ` Avoid: ${negativePrompt}.` : ''}`;
 
      if (videoTierValue === 'cinematic') {
        // Kling v2.5 Turbo Pro via Replicate. Duration input only accepts 5 or 10s.
        const klingResponse = await fetch('https://api.replicate.com/v1/predictions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + replicateToken },
          body: JSON.stringify({ version: 'kwaivgi/kling-v2.5-turbo-pro', input: { prompt: videoPrompt, image: referenceUrl, duration: videoSeconds >= 8 ? 10 : 5, ...(negativePrompt ? { negative_prompt: negativePrompt } : {}) } })
        });
        const klingData = await readJsonResponse(klingResponse);
        if (!klingResponse.ok || !klingData.id) {
          const detail = klingData.detail || klingData.error || `HTTP ${klingResponse.status}`;
          console.error('generate2: Replicate/Kling submit failed', { httpStatus: klingResponse.status, detail });
          return Response.json({ error: `Video generation failed to start: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` }, { status: 502 });
        }
        // Replicate jobs are never instant - hand back the prediction id and
        // which provider it came from, so the frontend can poll the right one.
        return Response.json({ pending: true, jobId: klingData.id, provider: 'replicate' }, { status: 202 });
      }
 
      // "Standard" tier: Alibaba Cloud Model Studio, Wan image-to-video.
      const wanModel = process.env.DASHSCOPE_VIDEO_MODEL || 'wan2.7-i2v-2026-04-25';
      const wanResponse = await fetch(`${dashscopeBase}/api/v1/services/aigc/video-generation/video-synthesis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + dashscopeKey, 'X-DashScope-Async': 'enable' },
        body: JSON.stringify({ model: wanModel, input: { prompt: videoPrompt, media: [{ type: 'first_frame', url: referenceUrl }] }, parameters: { resolution: resolutionValue === '480p' ? '480P' : '720P', duration: videoSeconds, prompt_extend: true, watermark: false } })
      });
      const wanData = await readJsonResponse(wanResponse);
      if (!wanResponse.ok || !wanData.output?.task_id) {
        const detail = wanData.message || wanData.error || wanData.code || `HTTP ${wanResponse.status}`;
        console.error('generate2: Alibaba/Wan video submit failed', { httpStatus: wanResponse.status, detail });
        return Response.json({ error: `Video generation failed to start: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` }, { status: 502 });
      }
      return Response.json({ pending: true, jobId: wanData.output.task_id, provider: 'alibaba' }, { status: 202 });
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
    // Only the 'edit' workflow reaches this point now - 'image' and 'video'
    // both return earlier above.
    const runpodEndpoint = editEndpoint;
    const runpodHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey };
    const runPath = editProvider === 'vllm-omni' ? 'run' : 'runsync';
    const response = await fetch(`https://api.runpod.ai/v2/${runpodEndpoint}/${runPath}`, { method: 'POST', headers: runpodHeaders, body: JSON.stringify({ input: requestInput }) });
    let data = await readJsonResponse(response);
    // A busy endpoint can return IN_QUEUE/IN_PROGRESS from runsync before the
    // worker has produced output. Poll the job instead of reporting a false
    // image-edit failure to the user.
    if (response.ok && (data.status === 'IN_QUEUE' || data.status === 'IN_PROGRESS') && data.id) {
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline && (data.status === 'IN_QUEUE' || data.status === 'IN_PROGRESS')) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const statusResponse = await fetch(`https://api.runpod.ai/v2/${runpodEndpoint}/status/${data.id}`, { headers: { Authorization: 'Bearer ' + apiKey } });
        data = await readJsonResponse(statusResponse);
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
    const imageResult = typeof image === 'string' && image.startsWith('data:') ? image : typeof image === 'string' && image.startsWith('http') ? image : `data:image/png;base64,${image}`;
    const { data: creditData, error: creditError } = await db.rpc('complete_generation_credit');
    if (creditError) {
      // Same as the video path: don't throw away a result that was already
      // generated (and paid for) just because the credit bookkeeping failed.
      console.error('generate2: complete_generation_credit failed', creditError);
      return Response.json({ image: imageResult, creditWarning: 'Your image is ready, but we could not finalize the credit for it.' });
    }
    return Response.json({ image: imageResult, remainingCredits: creditData?.remaining_credits });
  } catch { return Response.json({ error: 'Unable to generate an image right now. Your credit was not used.' }, { status: 500 }); }
}
 
