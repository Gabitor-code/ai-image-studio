import { createClient } from '@supabase/supabase-js';

export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const apiKey = process.env.RUNPOD_API_KEY, endpoint = process.env.RUNPOD_ENDPOINT_ID;
    const editEndpoint = process.env.RUNPOD_EDIT_ENDPOINT_ID;
    if (!token || !url || !anon) return Response.json({ error: 'Please sign in to create an image.' }, { status: 401 });
    const supabase = createClient(url, anon);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return Response.json({ error: 'Your sign-in session has expired. Please sign in again.' }, { status: 401 });
    const { prompt, style, resolution = '768', quality = 'high', referenceImage } = await request.json();
    if (!apiKey || !endpoint || (referenceImage && !editEndpoint)) return Response.json({ error: 'Image generation is not configured yet.' }, { status: 503 });
    if (!prompt || typeof prompt !== 'string' || prompt.length > 1000) return Response.json({ error: 'Please provide an image description up to 1,000 characters.' }, { status: 400 });
    const finalPrompt = `${style && style !== 'None' ? `${style} style, ` : ''}${referenceImage ? 'Keep the original subject identity and clothing recognizable, while clearly transforming the requested atmosphere, lighting, and environment. ' : ''}${prompt}`;
    const size = ['512', '768', '1024'].includes(String(resolution)) ? Number(resolution) : 768;
    const steps = quality === 'standard' ? 16 : 28;
    const db = createClient(url, anon, { global: { headers: { Authorization: 'Bearer ' + token } } });
    const { error: reserveError } = await db.rpc('reserve_generation_slot');
    if (reserveError) return Response.json({ error: reserveError.message.includes('INSUFFICIENT_CREDITS') ? 'You do not have enough credits to generate an image.' : 'Unable to verify your credits right now.' }, { status: 429 });
    const workflow = {
      '6': { inputs: { text: finalPrompt, clip: ['30', 1] }, class_type: 'CLIPTextEncode' },
      '8': { inputs: { samples: ['31', 0], vae: ['30', 2] }, class_type: 'VAEDecode' },
      '9': { inputs: { filename_prefix: 'Gabitor', images: ['8', 0] }, class_type: 'SaveImage' },
      '27': { inputs: { width: size, height: size, batch_size: 1 }, class_type: 'EmptySD3LatentImage' },
      '30': { inputs: { ckpt_name: 'flux1-dev-fp8.safetensors' }, class_type: 'CheckpointLoaderSimple' },
      '31': { inputs: { seed: Math.floor(Math.random() * 999999999999999), steps, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: referenceImage ? 0.5 : 1, model: ['30', 0], positive: ['35', 0], negative: ['33', 0], latent_image: referenceImage ? ['37', 0] : ['27', 0] }, class_type: 'KSampler' },
      '33': { inputs: { text: '', clip: ['30', 1] }, class_type: 'CLIPTextEncode' },
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
    const officialEditEndpoint = editEndpoint === 'qwen-image-edit' || editEndpoint === 'qwen-image-edit-2511';
    const qwenWorkflow = {
      '1': { class_type: 'UNETLoader', inputs: { unet_name: 'qwen_image_edit_2511_fp8mixed.safetensors', weight_dtype: 'default' } },
      '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', type: 'qwen_image', device: 'default' } },
      '3': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
      '4': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors', strength_model: 1 } },
      '5': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['4', 0], shift: 3 } },
      '6': { class_type: 'CFGNorm', inputs: { model: ['5', 0], strength: 1 } },
      '10': { class_type: 'LoadImage', inputs: { image: 'reference.png' } },
      '11': { class_type: 'ImageScale', inputs: { image: ['10', 0], upscale_method: 'lanczos', width: size, height: size, crop: 'center' } },
      '12': { class_type: 'VAEEncode', inputs: { pixels: ['11', 0], vae: ['3', 0] } },
      '20': { class_type: 'TextEncodeQwenImageEditPlus', inputs: { clip: ['2', 0], vae: ['3', 0], image1: ['11', 0], prompt: '' } },
      '21': { class_type: 'TextEncodeQwenImageEditPlus', inputs: { clip: ['2', 0], vae: ['3', 0], image1: ['11', 0], prompt: finalPrompt } },
      '30': { class_type: 'KSampler', inputs: { model: ['6', 0], positive: ['21', 0], negative: ['20', 0], latent_image: ['12', 0], seed: Math.floor(Math.random() * 999999999999999), steps: 4, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 } },
      '31': { class_type: 'VAEDecode', inputs: { samples: ['30', 0], vae: ['3', 0] } },
      '32': { class_type: 'SaveImage', inputs: { images: ['31', 0], filename_prefix: 'qwen_edit' } }
    };
    const requestInput = referenceImage
      ? officialEditEndpoint
        ? (editEndpoint === 'qwen-image-edit-2511'
          ? { prompt: finalPrompt, images: [referenceUrl], seed: -1, size: `${size}*${size}`, output_format: 'png' }
          : { prompt: finalPrompt, image: referenceUrl, seed: -1, output_format: 'png', enable_safety_checker: true })
        : { workflow, images: imagePayload }
      : { workflow, ...(imagePayload ? { images: imagePayload } : {}) };
    const response = await fetch(`https://api.runpod.ai/v2/${referenceImage ? editEndpoint : endpoint}/runsync`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey }, body: JSON.stringify({ input: requestInput }) });
    const data = await response.json();
    const first = data.output?.images?.[0];
    const image = first?.data || first?.image_url || first?.url || data.output?.message || data.output?.image || data.output?.image_url || data.output?.url || data.output?.image_base64;
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
