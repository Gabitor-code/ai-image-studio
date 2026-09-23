import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60;

// Shared by every provider below (Alibaba Cloud Model Studio, Replicate) -
// they all return plain JSON bodies, and this keeps a bad/non-JSON error
// body from throwing before we get a chance to report it.
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
    // Image generation (workflowMode 'image'), image-to-image editing
    // (workflowMode 'edit'), and the "Standard" video tier all run on
    // Alibaba Cloud Model Studio: Qwen-Image-3.0, Qwen-Image-Edit, and Wan
    // image-to-video, respectively. Only the "Cinematic" video tier uses a
    // separate provider - Kling v2.5 Turbo Pro via Replicate. RunPod/ComfyUI
    // is no longer used anywhere in this route.
    const dashscopeKey = process.env.DASHSCOPE_API_KEY;
    const dashscopeBase = process.env.DASHSCOPE_BASE_URL || 'https://dashscope-intl.aliyuncs.com';
    const replicateToken = process.env.REPLICATE_API_TOKEN;
    if (!token || !url || !anon) return Response.json({ error: 'Please sign in to create an image.' }, { status: 401 });
    const supabase = createClient(url, anon);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return Response.json({ error: 'Your sign-in session has expired. Please sign in again.' }, { status: 401 });
    const { prompt, style, resolution = '768', videoResolution = '720p', videoTier = 'standard', aspectRatio = '1:1', duration = 5, motion = 'medium', negativePrompt = '', seed = -1, referenceImage, workflowMode = referenceImage ? 'edit' : 'image' } = await request.json();
    const videoTierValue = videoTier === 'cinematic' ? 'cinematic' : 'standard';
    // Real cost, computed and enforced here (mirrors the display-only copy in
    // app/page.js's `creditCost` - keep the two in sync). Previously the two
    // RPC calls below were made with no arguments at all, so they silently
    // fell back to their `p_credits default 1` and every generation - image
    // or video, any tier/duration - only ever cost 1 credit.
    const isVideoWorkflow = workflowMode === 'video' || workflowMode === 'text-video';
    const videoSecondsForCost = [5, 8, 10].includes(Number(duration)) ? Number(duration) : 5;
    const videoResolutionForCost = ['720p', '1080p'].includes(videoResolution) ? videoResolution : '720p';
    const creditCost = isVideoWorkflow
      ? (videoTierValue === 'cinematic' ? 4 : (videoResolutionForCost === '1080p' ? 8 : 5)) * videoSecondsForCost
      : 2;
    if (
      ((workflowMode === 'image' || workflowMode === 'edit') && !dashscopeKey) ||
      ((workflowMode === 'video' || workflowMode === 'text-video') && (videoTierValue === 'cinematic' ? !replicateToken : !dashscopeKey))
    ) return Response.json({ error: 'This workflow is not configured yet.' }, { status: 503 });
    if (!prompt || typeof prompt !== 'string' || prompt.length > 1000) return Response.json({ error: 'Please provide an image description up to 1,000 characters.' }, { status: 400 });
    if (workflowMode === 'edit' && !referenceImage) return Response.json({ error: 'Please upload a reference image for image-to-image editing.' }, { status: 400 });
    const finalPrompt = `${style && style !== 'None' ? `${style} style, ` : ''}${referenceImage ? 'Keep the original subject identity and clothing recognizable, while clearly transforming the requested atmosphere, lighting, and environment. ' : ''}${prompt}`;
    const size = ['512', '768', '1024'].includes(String(resolution)) ? Number(resolution) : 768;
    const ratio = aspectRatio === '16:9' ? [size, Math.round(size * 9 / 16)] : aspectRatio === '9:16' ? [Math.round(size * 9 / 16), size] : [size, size];
    const [width, height] = ratio;
    const safeSeed = Number.isFinite(Number(seed)) && Number(seed) >= 0 ? Number(seed) : Math.floor(Math.random() * 999999999999999);
    // Qwen-Image's seed field (used by both the text-to-image and edit
    // models below) is a signed 32-bit int (max 2147483647) - safeSeed can
    // be much larger, so clamp it wherever it's sent to Alibaba.
    const dashscopeSeed = safeSeed % 2147483647;
    const db = createClient(url, anon, { global: { headers: { Authorization: 'Bearer ' + token } } });
    const { error: reserveError } = await db.rpc('reserve_generation_slot', { p_credits: creditCost });
    if (reserveError) return Response.json({ error: reserveError.message.includes('INSUFFICIENT_CREDITS') ? 'You do not have enough credits to generate an image.' : 'Unable to verify your credits right now.' }, { status: 429 });
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
      // (valid for 24h - it's re-hosted on Supabase/downloaded by the user
      // well before that).
      const imageModel = process.env.DASHSCOPE_IMAGE_MODEL || 'qwen-image-3.0-pro';
      const qwenBody = {
        model: imageModel,
        input: { messages: [{ role: 'user', content: [{ text: finalPrompt }] }] },
        parameters: { prompt_extend: true, n: 1, size: `${width}*${height}`, seed: dashscopeSeed, watermark: false, ...(negativePrompt ? { negative_prompt: negativePrompt } : {}) }
      };
      const qwenResponse = await fetch(`${dashscopeBase}/api/v1/services/aigc/multimodal-generation/generation`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + dashscopeKey }, body: JSON.stringify(qwenBody) });
      const qwenData = await readJsonResponse(qwenResponse);
      const qwenImageUrl = qwenData.output?.choices?.[0]?.message?.content?.find(item => item?.image)?.image;
      if (!qwenResponse.ok || !qwenImageUrl) {
        const detail = qwenData.message || qwenData.error || qwenData.code || `HTTP ${qwenResponse.status}`;
        console.error('generate2: Qwen-Image request failed', { httpStatus: qwenResponse.status, detail });
        return Response.json({ error: `Image generation failed: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` }, { status: 502 });
      }
      const { data: qwenCreditData, error: qwenCreditError } = await db.rpc('complete_generation_credit', { p_credits: creditCost });
      if (qwenCreditError) {
        console.error('generate2: complete_generation_credit failed', qwenCreditError);
        return Response.json({ image: qwenImageUrl, creditWarning: 'Your image is ready, but we could not finalize the credit for it.' });
      }
      return Response.json({ image: qwenImageUrl, remainingCredits: qwenCreditData?.remaining_credits });
    }
    if (workflowMode === 'edit') {
      // Qwen-Image-Edit (Alibaba Cloud Model Studio) - synchronous
      // image-to-image editing, same endpoint and response shape as
      // text-to-image above, but the reference image rides along in the
      // message content next to the text instruction. Qwen-Image-Edit has
      // no partial-denoise/strength input of its own - it always follows
      // the edit instruction directly, but does accept an explicit output
      // size, so pass the same width/height the user picked in Settings -
      // matching the image mode's size control 1:1. The UI's "reference
      // strength" control still isn't sent (kept for a future provider that
      // supports partial-denoise strength).
      // qwen-image-edit is a real, currently-listed Alibaba Cloud Model
      // Studio model (unlike the Hugging Face open-weights release name
      // "Qwen-Image-Edit-2511", which is not a DashScope model id) and its
      // official per-image price (~$0.045, international region) lands in
      // the same bracket as qwen-image-3.0-pro's 1K price ($0.04) above.
      const editModel = process.env.DASHSCOPE_EDIT_MODEL || 'qwen-image-edit';
      const editBody = {
        model: editModel,
        input: { messages: [{ role: 'user', content: [{ image: referenceUrl }, { text: finalPrompt }] }] },
        parameters: { n: 1, size: `${width}*${height}`, seed: dashscopeSeed, watermark: false, ...(negativePrompt ? { negative_prompt: negativePrompt } : {}) }
      };
      const editResponse = await fetch(`${dashscopeBase}/api/v1/services/aigc/multimodal-generation/generation`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + dashscopeKey }, body: JSON.stringify(editBody) });
      const editData = await readJsonResponse(editResponse);
      const editImageUrl = editData.output?.choices?.[0]?.message?.content?.find(item => item?.image)?.image;
      if (!editResponse.ok || !editImageUrl) {
        const detail = editData.message || editData.error || editData.code || `HTTP ${editResponse.status}`;
        console.error('generate2: Qwen-Image-Edit request failed', { httpStatus: editResponse.status, detail });
        return Response.json({ error: `Image edit failed: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` }, { status: 502 });
      }
      const { data: editCreditData, error: editCreditError } = await db.rpc('complete_generation_credit', { p_credits: creditCost });
      if (editCreditError) {
        console.error('generate2: complete_generation_credit failed', editCreditError);
        return Response.json({ image: editImageUrl, creditWarning: 'Your image is ready, but we could not finalize the credit for it.' });
      }
      return Response.json({ image: editImageUrl, remainingCredits: editCreditData?.remaining_credits });
    }
    if (workflowMode === 'text-video') {
      // Same async task-based flow as image-to-video below (poll
      // /api/video-status), but there's no reference image - just a prompt
      // and an explicit aspect ratio (there's no source photo to infer it
      // from). Also mirrors image-to-video's two-engine split:
      const videoSeconds = [5, 8, 10].includes(Number(duration)) ? Number(duration) : 5;
      const motionPhrase = motion === 'low' ? 'Keep the motion slow, gentle, and minimal.' : motion === 'high' ? 'Make the motion fast, dynamic, and energetic.' : 'Keep the motion natural and moderate.';
      const videoPrompt = `${finalPrompt} ${motionPhrase}`;
      const t2vAspectRatio = ['16:9', '9:16', '1:1'].includes(aspectRatio) ? aspectRatio : '16:9';

      if (videoTierValue === 'cinematic') {
        // Kling v2.5 Turbo Pro via Replicate handles both image-to-video and
        // text-to-video on the same model version - simply omit `image` for
        // a prompt-only generation. Duration input only accepts 5 or 10s.
        const klingResponse = await fetch('https://api.replicate.com/v1/predictions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + replicateToken },
          body: JSON.stringify({ version: 'kwaivgi/kling-v2.5-turbo-pro', input: { prompt: videoPrompt, aspect_ratio: t2vAspectRatio, duration: videoSeconds >= 8 ? 10 : 5, ...(negativePrompt ? { negative_prompt: negativePrompt } : {}) } })
        });
        const klingData = await readJsonResponse(klingResponse);
        if (!klingResponse.ok || !klingData.id) {
          const detail = klingData.detail || klingData.error || `HTTP ${klingResponse.status}`;
          console.error('generate2: Replicate/Kling text-to-video submit failed', { httpStatus: klingResponse.status, detail });
          return Response.json({ error: `Video generation failed to start: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` }, { status: 502 });
        }
        return Response.json({ pending: true, jobId: klingData.id, provider: 'replicate' }, { status: 202 });
      }

      // Standard tier: Wan2.7 text-to-video (Alibaba Cloud Model Studio).
      // Alibaba bills Standard text-to-video and image-to-video at the same
      // per-second rate, so this reuses the Standard tier's credit cost.
      const resolutionValue = ['720p', '1080p'].includes(videoResolution) ? videoResolution : '720p';
      const t2vModel = process.env.DASHSCOPE_T2V_MODEL || 'wan2.7-t2v-2026-06-12';
      const t2vResponse = await fetch(`${dashscopeBase}/api/v1/services/aigc/video-generation/video-synthesis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + dashscopeKey, 'X-DashScope-Async': 'enable' },
        body: JSON.stringify({ model: t2vModel, input: { prompt: videoPrompt, ...(negativePrompt ? { negative_prompt: negativePrompt } : {}) }, parameters: { resolution: resolutionValue === '1080p' ? '1080P' : '720P', ratio: t2vAspectRatio, duration: videoSeconds, seed: dashscopeSeed, prompt_extend: true, watermark: false } })
      });
      const t2vData = await readJsonResponse(t2vResponse);
      if (!t2vResponse.ok || !t2vData.output?.task_id) {
        const detail = t2vData.message || t2vData.error || t2vData.code || `HTTP ${t2vResponse.status}`;
        console.error('generate2: Alibaba/Wan text-to-video submit failed', { httpStatus: t2vResponse.status, detail });
        return Response.json({ error: `Video generation failed to start: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` }, { status: 502 });
      }
      return Response.json({ pending: true, jobId: t2vData.output.task_id, provider: 'alibaba' }, { status: 202 });
    }
    // workflowMode === 'video' from here on.
    if (!referenceImage) return Response.json({ error: 'Please upload an image for image-to-video generation.' }, { status: 400 });
    const videoSeconds = [5, 8, 10].includes(Number(duration)) ? Number(duration) : 5;
    // "Standard" (Alibaba Wan wan2.7-i2v) only accepts 720P or 1080P for
    // `parameters.resolution` - 480P is not a supported value for this
    // model and was previously being sent through as "480P" whenever the
    // UI's 480p option was picked, which Alibaba Cloud rejected on every
    // single call (InvalidParameter). "Cinematic" (Kling on Replicate)
    // picks its own output resolution (up to 1080p) - it has no resolution
    // input, so this value is only used for the Standard tier.
    const resolutionValue = ['720p', '1080p'].includes(videoResolution) ? videoResolution : '720p';
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
      body: JSON.stringify({ model: wanModel, input: { prompt: videoPrompt, media: [{ type: 'first_frame', url: referenceUrl }] }, parameters: { resolution: resolutionValue === '1080p' ? '1080P' : '720P', duration: videoSeconds, prompt_extend: true, watermark: false } })
    });
    const wanData = await readJsonResponse(wanResponse);
    if (!wanResponse.ok || !wanData.output?.task_id) {
      const detail = wanData.message || wanData.error || wanData.code || `HTTP ${wanResponse.status}`;
      console.error('generate2: Alibaba/Wan video submit failed', { httpStatus: wanResponse.status, detail });
      return Response.json({ error: `Video generation failed to start: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` }, { status: 502 });
    }
    return Response.json({ pending: true, jobId: wanData.output.task_id, provider: 'alibaba' }, { status: 202 });
  } catch { return Response.json({ error: 'Unable to generate an image right now. Your credit was not used.' }, { status: 500 }); }
}
