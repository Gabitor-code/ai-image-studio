// Next.js (App Router) turns this into a real /sitemap.xml at build time.
// There are only a handful of static routes today, but having a sitemap at
// all is what we submit to Google Search Console to get the site crawled
// and indexed in the first place - right now `site:gabitorai.com` returns
// nothing, so this is step one of fixing that.
export default function sitemap() {
  const base = 'https://gabitorai.com';
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/ai-product-photography-generator`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
