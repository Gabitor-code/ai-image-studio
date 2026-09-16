import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60;
const json = async (r) => { const t = await r.text(); try { return t ? JSON.parse(t) : {}; } catch { return { status: 'HTTP_' + r.status, error: t.slice(0, 500) }; } };

export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const apiKey = process.env.RUNPOD_API_KEY, imageEndpoint = process.env.RUNPOD_IMAGE_ENDPOINT_ID || process.env.RUNPOD_ENDPOINT_ID, editEndpoint = process.env.RUNPOD_EDIT_ENDPOINT_ID;
    if (!token || !url || !anon) return Response.json({error:'Please sign in to create an image.'},{status:401});
    const supabase = createClient(url, anon); const auth = await supabase.auth.getUser(token); const user = auth.data?.user;
    if (auth.error || !user) return Response.json({error:'Your sign-in session has expired. Please sign in again.'},{status:401});
    const body = await request.json(); const prompt = body.prompt, referenceImage = body.referenceImage;
    if (!apiKey || !imageEndpoint || (referenceImage && !editEndpoint)) return Response.json({error:'This workflow is not configured yet.'},{status:503});
    if (!prompt || typeof prompt !== 'string' || prompt.length > 1000) return Response.json({error:'Please provide an image description up to 1,000 characters.'},{status:400});
    const finalPrompt = (body.style && body.style !== 'None' ? body.style + ' style, ' : '') + (referenceImage ? 'Keep the original subject identity and clothing recognizable while changing only the requested scene. ' : '') + prompt;
    const db = createClient(url, anon, {global:{headers:{Authorization:'Bearer ' + token}}}); const reserved = await db.rpc('reserve_generation_slot');
    if (reserved.error) return Response.json({error: reserved.error.message.includes('INSUFFICIENT_CREDITS') ? 'You do not have enough credits to generate an image.' : 'Unable to verify your credits right now.'},{status:429});
    let imageUrl = referenceImage;
    if (referenceImage?.startsWith('data:image/')) { const m = referenceImage.match(/^data:(image\/[^;]+);base64,(.+)$/); if (!m) return Response.json({error:'The reference image format is invalid.'},{status:400}); const ext=m[1].split('/')[1].replace('jpeg','jpg'); const path=user.id+'/'+Date.now()+'.'+ext; const up=await db.storage.from('references').upload(path,Buffer.from(m[2],'base64'),{contentType:m[1],upsert:false}); if (up.error) return Response.json({error:'Reference image storage is not configured yet.'},{status:503}); imageUrl=db.storage.from('references').getPublicUrl(path).data.publicUrl; }
    const provider = process.env.RUNPOD_EDIT_PROVIDER || ''; const vllm = referenceImage && provider === 'vllm-omni';
    const input = referenceImage && vllm ? {route:'/v1/images/edits',body:{prompt:finalPrompt,image_b64:[referenceImage.replace(/^data:image\/[^;]+;base64,/,'')]}} : referenceImage ? {prompt:finalPrompt,image_url:imageUrl} : {prompt:finalPrompt};
    const ep = referenceImage ? editEndpoint : imageEndpoint; const path = vllm ? 'run' : 'runsync'; const res = await fetch('https://api.runpod.ai/v2/'+ep+'/'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},body:JSON.stringify({input})}); let data=await json(res);
    if (res.ok && (data.status==='IN_QUEUE'||data.status==='IN_PROGRESS') && data.id) { const until=Date.now()+55000; while(Date.now()<until && (data.status==='IN_QUEUE'||data.status==='IN_PROGRESS')) { await new Promise(r=>setTimeout(r,2000)); const sr=await fetch('https://api.runpod.ai/v2/'+ep+'/status/'+data.id,{headers:{Authorization:'Bearer '+apiKey}}); data=await json(sr); } }
    const first=data.output?.images?.[0]||data.output?.data?.[0]||data.output?.body?.data?.[0]; const image=first?.data||first?.b64_json||first?.image_url||first?.url||data.output?.image||data.output?.image_url||data.output?.url||data.output?.image_base64;
    if (!res.ok || data.status==='FAILED' || !image) return Response.json({error:'RunPod image edit failed: '+(data.error||data.output?.error||data.status||'no image')},{status:502});
    const done=await db.rpc('complete_generation_credit'); return Response.json({image:typeof image==='string'&&image.startsWith('http')?image:'data:image/png;base64,'+image,remainingCredits:done.data?.remaining_credits});
  } catch (e) { return Response.json({error:'Unable to generate an image right now. Your credit was not used.'},{status:500}); }
}
