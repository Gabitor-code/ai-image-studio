import './globals.css';
import { Analytics } from '@vercel/analytics/next';

// SEO baseline for the US market: the generic one-liner this used to carry
// (no keywords, no Open Graph/Twitter card, no canonical) meant a shared
// link had no preview and search engines had nothing but a bare title to
// work with. metadataBase lets every relative url/image below resolve to an
// absolute https://gabitorai.com/... URL automatically.
const siteUrl = 'https://gabitorai.com';
const title = 'Gabitor AI — AI Image & Video Generator';
const description = 'Turn a prompt or a single photo into AI-generated images and cinematic video in seconds. Try image-to-video, text-to-video, and AI photo editing free with 15 starter credits.';

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: title, template: '%s · Gabitor AI' },
  description,
  keywords: ['AI image generator', 'AI video generator', 'image to video AI', 'text to video AI', 'AI photo editor', 'AI product photography generator', 'cinematic AI video generator'],
  alternates: { canonical: '/' },
  openGraph: {
    title,
    description,
    url: siteUrl,
    siteName: 'Gabitor AI',
    images: [{ url: '/images/gabitor-future-ai.webp', width: 1200, height: 630, alt: 'Gabitor AI — AI image and video generator' }],
    locale: 'en_US',
    type: 'website'
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['/images/gabitor-future-ai.webp']
  }
};

// Basic SoftwareApplication structured data so search engines can surface
// pricing/rating-style rich results for the product rather than treating it
// as an anonymous page. Kept minimal and accurate (no fabricated ratings).
const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Gabitor AI',
  url: siteUrl,
  applicationCategory: 'DesignApplication',
  operatingSystem: 'Web',
  description,
  offers: { '@type': 'Offer', price: '10', priceCurrency: 'USD', description: 'Starter credit pack (200 credits)' }
};

export default function RootLayout({ children }) {
  return <html lang="en-US"><head><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} /></head><body>{children}<Analytics /></body></html>;
}
