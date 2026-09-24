// Dedicated landing page for a specific, lower-competition use case (see the
// SEO audit: head terms like "best AI image generator" are dominated by
// large content-marketing sites, but "AI product photography generator" has
// real search demand and far less competition, and matches what Gabitor
// actually does well - Qwen-Image editing with a reference photo).
export const metadata = {
  title: 'AI Product Photography Generator — Studio-Quality Shots From One Photo',
  description: 'Turn a single product photo into studio-quality AI product photography. Change backgrounds, lighting, and scenes in seconds — no photo studio, no reshoot. Try it free with 15 credits.',
  alternates: { canonical: '/ai-product-photography-generator' },
  openGraph: {
    title: 'AI Product Photography Generator — Gabitor AI',
    description: 'Turn a single product photo into studio-quality AI product photography in seconds.',
    url: 'https://gabitorai.com/ai-product-photography-generator',
    images: [{ url: '/gallery/prism-bottle.webp', width: 1200, height: 630, alt: 'AI-generated product photography example' }],
    type: 'article'
  }
};

const steps = [
  ['1. Upload your product photo', 'A plain phone photo works fine — a bottle on a kitchen counter, a shoe on a plain background, a box on a desk. Gabitor only needs to see the product clearly.'],
  ['2. Describe the scene you want', 'Tell it the setting, lighting, and mood — "on deep-blue marble under soft studio light" or "on a rustic wooden table by a sunlit window." No styling budget or physical set required.'],
  ['3. Get a studio-quality result in seconds', 'Gabitor keeps your product accurate while placing it in the new scene. Download the image and use it on your store, marketplace listing, or ad straight away.'],
];

const useCases = [
  ['E-commerce listings', 'Give every SKU a consistent, on-brand look across Shopify, Amazon, or Etsy without booking a photo studio for each new product.'],
  ['Seasonal & campaign creative', 'Reuse one product photo across dozens of scenes — a holiday backdrop, a summer setting, a minimalist studio look — for ads and email campaigns.'],
  ['Small business & dropshipping', 'If you don’t have product samples in hand or budget for a shoot, start from a supplier photo and generate the scenes you need.'],
  ['A/B testing creative', 'Generate several background and lighting variations of the same product in minutes to see which one converts better, instead of guessing.'],
];

const faqs = [
  ['Do I need professional photography experience?', 'No. You upload one photo of your product and describe the scene in plain language — Gabitor handles the lighting, composition, and background generation.'],
  ['Will it change the product itself?', 'The goal is to keep your product accurate while changing the surrounding scene, lighting, and background. Very small or highly reflective products can be more sensitive to exact color matching, so always review the result before publishing.'],
  ['What image sizes can I generate?', 'Gabitor supports 512, 768, and 1024px output, plus 1:1, 16:9, and 9:16 aspect ratios, so you can match square marketplace listings or vertical social ad formats.'],
  ['How much does it cost?', 'New accounts get 15 free credits to try it. After that, credit packs start at $10 for 200 credits (about 100 images at standard quality) — see the pricing on the main page for details.'],
];

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map(([question, answer]) => ({
    '@type': 'Question',
    name: question,
    acceptedAnswer: { '@type': 'Answer', text: answer }
  }))
};

const sectionStyle = { maxWidth: 760, margin: '0 auto', padding: '0 24px' };

export default function AIProductPhotographyGenerator() {
  return (
    <main style={{ minHeight: '100vh', background: '#0d0e13', color: '#dfe1ee', lineHeight: 1.7 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      <div style={{ ...sectionStyle, paddingTop: 72 }}>
        <a href="/" style={{ color: '#b9a7ff', textDecoration: 'none' }}>← Back to Gabitor</a>
        <p style={{ letterSpacing: '0.14em', fontSize: 12, color: '#b9a7ff', marginTop: 40 }}>GABITOR AI · PRODUCT PHOTOGRAPHY</p>
        <h1 style={{ fontSize: 44, lineHeight: 1.15, margin: '8px 0 16px', color: '#fff' }}>AI Product Photography Generator</h1>
        <p style={{ fontSize: 18, color: '#c7cad6' }}>Turn one ordinary product photo into studio-quality shots — new backgrounds, lighting, and scenes in seconds, without booking a photo studio or reshoot.</p>
        <a href="/#studio" style={{ display: 'inline-block', marginTop: 24, padding: '13px 22px', borderRadius: 8, background: '#7764ff', color: '#fff', textDecoration: 'none', fontWeight: 600 }}>Try it free — 15 credits included →</a>
      </div>

      <div style={{ ...sectionStyle, marginTop: 64 }}>
        <h2 style={{ fontSize: 26, color: '#b9a7ff' }}>Why AI product photography?</h2>
        <p>Professional product photography is one of the biggest recurring costs for small e-commerce businesses — a single studio session can run hundreds of dollars per product, and every new variant, season, or campaign usually means booking another one. Gabitor AI removes that bottleneck: upload one photo of your actual product, describe the scene you want, and get a new, polished image back in seconds. It won&apos;t replace a full studio shoot for every use case, but for listings, ads, and campaign creative that need to look good and change often, it removes the reshoot entirely.</p>
      </div>

      <div style={{ ...sectionStyle, marginTop: 56 }}>
        <h2 style={{ fontSize: 26, color: '#b9a7ff' }}>How it works</h2>
        {steps.map(([title, body]) => (
          <div key={title} style={{ marginTop: 22 }}>
            <h3 style={{ fontSize: 18, color: '#fff', marginBottom: 6 }}>{title}</h3>
            <p style={{ margin: 0 }}>{body}</p>
          </div>
        ))}
      </div>

      <div style={{ ...sectionStyle, marginTop: 56 }}>
        <h2 style={{ fontSize: 26, color: '#b9a7ff' }}>Who uses this</h2>
        {useCases.map(([title, body]) => (
          <div key={title} style={{ marginTop: 22 }}>
            <h3 style={{ fontSize: 18, color: '#fff', marginBottom: 6 }}>{title}</h3>
            <p style={{ margin: 0 }}>{body}</p>
          </div>
        ))}
      </div>

      <div style={{ ...sectionStyle, marginTop: 56 }}>
        <h2 style={{ fontSize: 26, color: '#b9a7ff' }}>Frequently asked questions</h2>
        {faqs.map(([question, answer]) => (
          <div key={question} style={{ marginTop: 22 }}>
            <h3 style={{ fontSize: 18, color: '#fff', marginBottom: 6 }}>{question}</h3>
            <p style={{ margin: 0 }}>{answer}</p>
          </div>
        ))}
      </div>

      <div style={{ ...sectionStyle, margin: '64px auto 96px', textAlign: 'center' }}>
        <h2 style={{ fontSize: 26, color: '#fff' }}>Ready to try it on your own product?</h2>
        <p>No credit card required to start — sign up and get 15 free credits.</p>
        <a href="/#studio" style={{ display: 'inline-block', marginTop: 8, padding: '13px 22px', borderRadius: 8, background: '#7764ff', color: '#fff', textDecoration: 'none', fontWeight: 600 }}>Open the studio →</a>
      </div>
    </main>
  );
}
