// Forces a real "Save As" download for generated images/videos.
//
// The frontend used to link straight to the provider's URL (Replicate's
// replicate.delivery CDN, or Alibaba OSS) with an <a download> attribute.
// That attribute is silently ignored by browsers for cross-origin URLs, so
// clicking "Download" just opened/played the file instead of saving it.
// This route fetches the file server-side (same-origin from the browser's
// point of view) and re-serves it with a Content-Disposition: attachment
// header, which forces the download regardless of where the bytes came from.
//
// Only allowed to fetch from the providers we actually generate media with -
// never an arbitrary URL - so this can't be turned into an open proxy/SSRF
// vector.
const ALLOWED_HOST_SUFFIXES = [
  '.replicate.delivery',
  'replicate.delivery',
  '.aliyuncs.com',
  'aliyuncs.com',
];

function isAllowedHost(hostname) {
  return ALLOWED_HOST_SUFFIXES.some(suffix => hostname === suffix.replace(/^\./, '') || hostname.endsWith(suffix));
}

export async function GET(request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const source = searchParams.get('url');
    const filename = (searchParams.get('filename') || 'gabitor-creation').replace(/[^a-zA-Z0-9_.-]/g, '_');
    if (!source) return Response.json({ error: 'Missing url.' }, { status: 400 });

    let parsed;
    try { parsed = new URL(source); } catch { return Response.json({ error: 'Invalid url.' }, { status: 400 }); }
    if (parsed.protocol !== 'https:' || !isAllowedHost(parsed.hostname)) {
      return Response.json({ error: 'This file host is not allowed.' }, { status: 400 });
    }

    const upstream = await fetch(parsed.toString());
    if (!upstream.ok || !upstream.body) {
      return Response.json({ error: 'Could not fetch the file for download.' }, { status: 502 });
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Content-Disposition', `attachment; filename="${filename}"`);
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) headers.set('Content-Length', contentLength);

    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    console.error('download: failed', error);
    return Response.json({ error: 'Unable to download the file right now.' }, { status: 500 });
  }
}
