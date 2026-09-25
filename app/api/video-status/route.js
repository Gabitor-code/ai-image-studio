import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60;

// Copies a provider's temporary video URL (Alibaba/Replicate links can
// expire or be revoked) into our own "generated-media" Storage bucket, so
// "My creations" and the generations table always point at a URL we
// control instead of a temporary provider link. Non-fatal: any failure
// here just falls back to the original (temporary) URL rather than failing
// the whole request - the user still gets their video back either way.
async function persistGeneratedMedia(db, userId, sourceUrl, mediaType) {
  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const contentType = response.headers.get('content-type') || (mediaType === 'video' ? 'video/mp4' : 'image/png');
    const ext = mediaType === 'video' ? 'mp4' : (contentType.split('/')[1] || 'png').split(';')[0].replace('jpeg', 'jpg');
    const bytes = Buffer.from(await response.arrayBuffer());
    const path = `${userId}/${Date.now()}.${ext}`;
    const { error: uploadError } = await db.storage.from('generated-media').upload(path, bytes, { contentType, upsert: false });
    if (uploadError) throw uploadError;
    return db.storage.from('generated-media').getPublicUrl(path).data.publicUrl;
  } catch (error) {
    console.error('video-status: persistGeneratedMedia failed, falling back to provider URL', { mediaType, error });
    return sourceUrl;
  }
}
 
async function readJsonResponse(response) {
  const body = await response.text();
  if (!body) return { status: response.ok ? undefined : `HTTP_${response.status}` };
  try { return JSON.parse(body); }
  catch { return { status: `HTTP_${response.status}`, error: body.slice(0, 500) }; }
}
 
// Replicate's `output` field shape varies by model (a single URL string, or
// an array of URLs/frames) - walk it defensively rather than assuming one shape.
function extractVideo(value) {
  if (typeof value === 'string') {
    if (value.startsWith('data:video/')) return value;
    if (/^https?:\/\//i.test(value)) return value;
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractVideo(item);
      if (found) return found;
    }
    return null;
  }
  for (const key of ['video_url', 'videoUrl', 'video', 'url', 'output']) {
    const found = extractVideo(value[key]);
    if (found) return found;
  }
  return null;
}
 
export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const searchParams = new URL(request.url).searchParams;
    const jobId = searchParams.get('jobId')?.trim().replace(/^['"]|['"]$/g, '');
    // 'provider' tells us which API submitted the job (set by generate2's
    // response and echoed back by the frontend) - defaults to 'alibaba' for
    // safety, since that's the Standard (default) tier.
    const provider = searchParams.get('provider') === 'replicate' ? 'replicate' : 'alibaba';
    if (!token || !url || !anon || !jobId) return Response.json({ error: 'Video status is not configured.' }, { status: 400 });
    const supabase = createClient(url, anon);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return Response.json({ error: 'Your sign-in session has expired. Please sign in again.' }, { status: 401 });
    // The RPC call below must run as the signed-in user (it looks up their row
    // via auth.uid()), so it needs a client carrying their JWT - the plain
    // `supabase` client above only has the anon key and runs as the anonymous
    // role, which was silently failing the credit RPC on every completed video.
    const db = createClient(url, anon, { global: { headers: { Authorization: 'Bearer ' + token } } });
 
    let video = null;
    if (provider === 'replicate') {
      const replicateToken = process.env.REPLICATE_API_TOKEN;
      if (!replicateToken) return Response.json({ error: 'Video status is not configured.' }, { status: 400 });
      const statusResponse = await fetch(`https://api.replicate.com/v1/predictions/${jobId}`, { headers: { Authorization: 'Bearer ' + replicateToken } });
      const statusData = await readJsonResponse(statusResponse);
      if (!statusResponse.ok) {
        console.error('video-status: Replicate status request failed', { httpStatus: statusResponse.status, jobId, statusData });
        return Response.json({ error: `Replicate video status failed: ${statusData.detail || statusData.error || JSON.stringify(statusData)}` }, { status: 502 });
      }
      if (statusData.status === 'starting' || statusData.status === 'processing') return Response.json({ pending: true, status: statusData.status }, { status: 202 });
      if (statusData.status !== 'succeeded') {
        console.error('video-status: REPLICATE_RAW_STATUS_DEBUG', JSON.stringify({ jobId, statusData }).slice(0, 4000));
        return Response.json({ error: `Video generation failed: ${statusData.status || 'unknown status'}${statusData.error ? ` — ${statusData.error}` : ''}` }, { status: 502 });
      }
      video = extractVideo(statusData.output);
    } else {
      const dashscopeKey = process.env.DASHSCOPE_API_KEY;
      const dashscopeBase = process.env.DASHSCOPE_BASE_URL || 'https://dashscope-intl.aliyuncs.com';
      if (!dashscopeKey) return Response.json({ error: 'Video status is not configured.' }, { status: 400 });
      const statusResponse = await fetch(`${dashscopeBase}/api/v1/tasks/${jobId}`, { headers: { Authorization: 'Bearer ' + dashscopeKey } });
      const statusData = await readJsonResponse(statusResponse);
      if (!statusResponse.ok) {
        console.error('video-status: Alibaba status request failed', { httpStatus: statusResponse.status, jobId, statusData });
        return Response.json({ error: `Alibaba Cloud video status failed: ${statusData.message || statusData.error || JSON.stringify(statusData)}` }, { status: 502 });
      }
      const taskStatus = statusData.output?.task_status;
      if (taskStatus === 'PENDING' || taskStatus === 'RUNNING') return Response.json({ pending: true, status: taskStatus }, { status: 202 });
      if (taskStatus !== 'SUCCEEDED') {
        console.error('video-status: ALIBABA_RAW_STATUS_DEBUG', JSON.stringify({ jobId, statusData }).slice(0, 4000));
        return Response.json({ error: `Video generation failed: ${taskStatus || statusData.output?.message || 'unknown status'}` }, { status: 502 });
      }
      video = statusData.output?.video_url || null;
    }
 
    if (!video) {
      console.error('video-status: no video URL in completed response', { provider, jobId });
      return Response.json({ error: 'Video generation finished but no video was returned.' }, { status: 502 });
    }
 
    // complete_video_job() both verifies that this job belongs to the
    // signed-in user (previously nothing did - a jobId is provider data, not
    // a secret, so without this check anyone who learned or guessed another
    // user's jobId could poll this endpoint and get back their video) and
    // charges that job's own recorded cost, rather than a single "pending"
    // slot shared across all of a user's in-flight generations.
    // Passing the finished video's URL lets complete_video_job() also write
    // a row into `generations` (the account-level gallery) now that the
    // output actually exists - the pending video_jobs row only ever had the
    // job id/prompt, never the finished media.
    const persistedVideo = await persistGeneratedMedia(db, user.id, video, 'video');

    const { data: creditData, error: creditError } = await db.rpc('complete_video_job', { p_job_id: jobId, p_output_path: persistedVideo });
    if (creditError) {
      if (creditError.message?.includes('JOB_NOT_FOUND')) {
        console.error('video-status: job not found or not owned by caller', { jobId, provider });
        return Response.json({ error: 'This video could not be found for your account.' }, { status: 404 });
      }
      // The video generated successfully and the provider was already paid for
      // it - never throw that away just because the credit bookkeeping failed.
      // Show the user their video and only warn about the credit separately.
      console.error('video-status: complete_video_job failed', { jobId, creditError });
      return Response.json({ ready: true, video: persistedVideo, creditWarning: 'Your video is ready, but we could not finalize the credit for it.' });
    }
    return Response.json({ ready: true, video: persistedVideo, remainingCredits: creditData?.remaining_credits });
  } catch { return Response.json({ error: 'Unable to check the video right now.' }, { status: 500 }); }
}
 
