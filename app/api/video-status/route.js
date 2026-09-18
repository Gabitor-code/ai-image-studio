import { createClient } from '@supabase/supabase-js';

async function readRunpodResponse(response) {
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
  for (const key of ['video_url', 'videoUrl', 'video', 'url', 'file', 'filename', 'video_base64', 'b64_json', 'output', 'body', 'data', 'result']) {
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
    const apiKey = process.env.RUNPOD_API_KEY;
    const videoEndpoint = process.env.RUNPOD_VIDEO_ENDPOINT_ID;
    const jobId = new URL(request.url).searchParams.get('jobId')?.trim().replace(/^['"]|['"]$/g, '');
    if (!token || !url || !anon || !apiKey || !videoEndpoint || !jobId) return Response.json({ error: 'Video status is not configured.' }, { status: 400 });
    const supabase = createClient(url, anon);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return Response.json({ error: 'Your sign-in session has expired. Please sign in again.' }, { status: 401 });
    const response = await fetch(`https://api.runpod.ai/v2/${videoEndpoint}/status/${jobId}`, { headers: { Authorization: 'Bearer ' + apiKey } });
    const data = await readRunpodResponse(response);
    if (!response.ok) {
      const detail = data.error || data.message || data.detail || data.status || JSON.stringify(data);
      console.error('video-status: RunPod status request failed', { httpStatus: response.status, jobId, detail });
      return Response.json({ error: `RunPod video status failed: ${detail}` }, { status: 502 });
    }
    if (data.status === 'IN_QUEUE' || data.status === 'IN_PROGRESS') return Response.json({ pending: true, status: data.status }, { status: 202 });
    const video = extractVideo(data.output) || extractVideo(data.video);
    if (data.status === 'FAILED' || !video) return Response.json({ error: `RunPod video generation failed: ${data.error || data.output?.error || data.status || 'no video returned'}` }, { status: 502 });
    const { data: creditData, error: creditError } = await supabase.rpc('complete_generation_credit');
    if (creditError) return Response.json({ error: 'Your video was created, but we could not finalize the credit.' }, { status: 500 });
    const videoResult = video.startsWith('data:') || video.startsWith('http') ? video : `data:video/mp4;base64,${video}`;
    return Response.json({ ready: true, video: videoResult, remainingCredits: creditData?.remaining_credits });
  } catch { return Response.json({ error: 'Unable to check the video right now.' }, { status: 500 }); }
}
