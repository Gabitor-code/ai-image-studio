import { createClient } from '@supabase/supabase-js';

// Must match the model id used to submit the job in generate2/route.js.
const FAL_MODEL = 'bytedance/seedance-2.5/image-to-video';

async function readFalResponse(response) {
  const body = await response.text();
  if (!body) return { status: response.ok ? undefined : `HTTP_${response.status}` };
  try { return JSON.parse(body); }
  catch { return { status: `HTTP_${response.status}`, error: body.slice(0, 500) }; }
}

function extractVideo(value) {
  if (typeof value === 'string') {
    if (value.startsWith('data:video/')) return value;
    if (/^https?:\/\//i.test(value)) return value;
    if (value.length > 100000) return value;
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
  for (const key of ['video_url', 'videoUrl', 'video', 'url', 'file', 'filename', 'video_base64', 'b64_json', 'data_b64', 'output', 'body', 'data', 'result']) {
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
    const falKey = process.env.FAL_KEY;
    const jobId = new URL(request.url).searchParams.get('jobId')?.trim().replace(/^['"]|['"]$/g, '');
    if (!token || !url || !anon || !falKey || !jobId) return Response.json({ error: 'Video status is not configured.' }, { status: 400 });
    const supabase = createClient(url, anon);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return Response.json({ error: 'Your sign-in session has expired. Please sign in again.' }, { status: 401 });
    // The RPC call below must run as the signed-in user (it looks up their row
    // via auth.uid()), so it needs a client carrying their JWT - the plain
    // `supabase` client above only has the anon key and runs as the anonymous
    // role, which was silently failing the credit RPC on every completed video.
    const db = createClient(url, anon, { global: { headers: { Authorization: 'Bearer ' + token } } });
    const falHeaders = { Authorization: 'Key ' + falKey };
    const statusResponse = await fetch(`https://queue.fal.run/${FAL_MODEL}/requests/${jobId}/status`, { headers: falHeaders });
    const statusData = await readFalResponse(statusResponse);
    if (!statusResponse.ok) {
      const detail = statusData.error || statusData.detail || statusData.status || JSON.stringify(statusData);
      console.error('video-status: fal status request failed', { httpStatus: statusResponse.status, jobId, detail });
      return Response.json({ error: `fal.ai video status failed: ${detail}` }, { status: 502 });
    }
    if (statusData.status === 'IN_QUEUE' || statusData.status === 'IN_PROGRESS') return Response.json({ pending: true, status: statusData.status }, { status: 202 });
    if (statusData.status !== 'COMPLETED') {
      console.error('video-status: FAL_RAW_STATUS_DEBUG', JSON.stringify({ jobId, statusData }).slice(0, 4000));
      return Response.json({ error: `fal.ai video generation failed: ${statusData.status || statusData.error || 'unknown status'}` }, { status: 502 });
    }
    const resultResponse = await fetch(`https://queue.fal.run/${FAL_MODEL}/requests/${jobId}`, { headers: falHeaders });
    const resultData = await readFalResponse(resultResponse);
    const video = extractVideo(resultData);
    if (!resultResponse.ok || !video) {
      console.error('video-status: FAL_RAW_OUTPUT_DEBUG', JSON.stringify({ jobId, raw: resultData }).slice(0, 4000));
      const detail = resultData.error || resultData.detail || 'no video returned';
      return Response.json({ error: `fal.ai video generation failed: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` }, { status: 502 });
    }
    const { data: creditData, error: creditError } = await db.rpc('complete_generation_credit');
    if (creditError) {
      // The video generated successfully and fal.ai was already paid for it -
      // never throw that away just because the credit bookkeeping failed.
      // Show the user their video and only warn about the credit separately.
      console.error('video-status: complete_generation_credit failed', { jobId, creditError });
      return Response.json({ ready: true, video, creditWarning: 'Your video is ready, but we could not finalize the credit for it.' });
    }
    return Response.json({ ready: true, video, remainingCredits: creditData?.remaining_credits });
  } catch { return Response.json({ error: 'Unable to check the video right now.' }, { status: 500 }); }
}
