export async function POST(request) {
  try {
    const { prompt } = await request.json();
    if (!prompt || typeof prompt !== 'string') {
      return Response.json({ error: 'Please provide an image description.' }, { status: 400 });
    }

    const apiKey = process.env.RUNPOD_API_KEY;
    const endpointId = process.env.RUNPOD_ENDPOINT_ID;
    if (!apiKey || !endpointId) {
      return Response.json({ error: 'Image generation is not configured yet.' }, { status: 503 });
    }

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

    const response = await fetch(
      `https://api.runpod.ai/v2/${endpointId}/runsync`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ input: { workflow } }) }
    );
    const data = await response.json();
    if (!response.ok || data.status === 'FAILED') {
      return Response.json({ error: data.error || data.output?.error || 'Generation failed. Please try again.' }, { status: 502 });
    }

    const image = data.output?.message;
    if (!image) return Response.json({ error: 'RunPod did not return an image.' }, { status: 502 });
    return Response.json({ image });
  } catch (error) {
    return Response.json({ error: 'Unable to generate an image right now.' }, { status: 500 });
  }
}

