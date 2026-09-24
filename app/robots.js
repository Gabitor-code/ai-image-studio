// Next.js (App Router) turns this into a real /robots.txt at build time.
// Nothing existed here before, which isn't a block on its own, but it also
// meant we never pointed crawlers at the sitemap below.
export default function robots() {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: 'https://gabitorai.com/sitemap.xml',
  };
}
