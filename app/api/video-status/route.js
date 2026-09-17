import { createClient } from '@supabase/supabase-js';

async function readRunpodResponse(response) {
  const body = await response.text();
  if (!body) return { status: response.ok ? undefined : `HTTP_${response.status}` };
  try { return JSON.parse(body); }
  catch { return { status: `HTTP_${response.status}`, error: body.slice(0, 500) }; }
}

export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const apiKey = process.env.RUNPOD_API_KEY;
    const videoEndpoint = process.env.RUNPOD_VIDEO_ENDPOINT_ID;
    const jobId = new URL(request.url).searchParams.get('jobId');
    if (!token || !url || !anon || !apiKey || !videoEndpoint || !jobId) return Response.json({ error: 'Video status is not configured.' }, { status: 400 });
    const supabase = createClient(url, anon);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return Response.json({ error: 'Your sign-in session has expired. Please sign in again.' }, { status: 401 });
    const response = await fetch(`https://api.runpod.ai/v2/${videoEndpoint}/status/${encodeURIComponent(jobId)}`, { headers: { Authorization: 'Bearer ' + apiKey } });
    const data = await readRunpodResponse(response);
    if (!response.ok) return Response.json({ error: `RunPod video status failed: ${data.error || data.status || response.status}` }, { status: 502 });
    if (data.status === 'IN_QUEUE' || data.status === 'IN_PROGRESS') return Response.json({ pending: true, status: data.status }, { status: 202 });
    const video = data.output?.video_url || data.output?.video || data.video || data.output?.body?.video;
    if (data.status === 'FAILED' || !video) return Response.json({ error: `RunPod video generation failed: ${data.error || data.output?.error || data.status || 'no video returned'}` }, { status: 502 });
    const { data: creditData, error: creditError } = await supabase.rpc('complete_generation_credit');
    if (creditError) return Response.json({ error: 'Your video was created, but we could not finalize the credit.' }, { status: 500 });
    return Response.json({ ready: true, video: video.startsWith('data:') ? video : `data:video/mp4;base64,${video}`, remainingCredits: creditData?.remaining_credits });
  } catch { return Response.json({ error: 'Unable to check the video right now.' }, { status: 500 }); }
}
