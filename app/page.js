'use client';

import { useState } from 'react';

const samples = [
  ['Neon Nights', 'A futuristic city after rain, with neon reflections across the streets', 'image'],
  ['Product Film', 'A premium product showcase with soft, cinematic studio lighting', 'video'],
  ['Dreamscape', 'Floating islands at sunset, rendered with cinematic detail', 'image']
];

export default function Home() {
  const [mode, setMode] = useState('image');
  const [prompt, setPrompt] = useState('');
  const [notice, setNotice] = useState('');
  const [showGallery, setShowGallery] = useState(false);

  function generate() {
    if (!prompt.trim()) {
      setNotice('Start by writing a short description.');
      return;
    }
    setNotice('Image and video generation will be available here soon.');
  }

  return (
    <main>
      <nav className="nav">
        <a className="brand" href="#top"><span>✦</span> GABITOR</a>
        <div className="nav-links"><a href="#studio">Studio</a><a href="#gallery">Gallery</a><a href="#pricing">Pricing</a></div>
        <button className="account" onClick={() => setNotice('Sign in will be available once account access is connected.')}>Sign in</button>
      </nav>

      <section id="top" className="hero">
        <p className="eyebrow">AI CREATIVE STUDIO</p>
        <h1>Create images.<br/><em>Tell stories in motion.</em></h1>
        <p className="lead">One creative studio where your ideas become visuals. Make images and videos shaped around your vision.</p>
        <a className="start" href="#studio">Start creating <span>↓</span></a>
        <div className="orb orb-one"/><div className="orb orb-two"/>
      </section>

      <section id="studio" className="studio-wrap">
        <div className="section-title"><p>01 / STUDIO</p><h2>What will you create?</h2></div>
        <div className="studio-card">
          <div className="mode-row">
            <button className={mode === 'image' ? 'mode active' : 'mode'} onClick={() => setMode('image')}><span>◈</span> Image</button>
            <button className={mode === 'video' ? 'mode active' : 'mode'} onClick={() => setMode('video')}><span>▷</span> Video</button>
          </div>
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder={mode === 'image' ? 'Example: An elegant perfume bottle in moonlight, on deep-blue marble...' : 'Example: A vintage sports car driving slowly through a sunlit Italian village...'} />
          <div className="card-bottom"><button className="settings">✧ Settings</button><button className="generate" onClick={generate}>Generate <span>→</span></button></div>
          {notice && <p className="notice">{notice}</p>}
        </div>
        <div className="credit-line"><span>✦</span> 15 credits available <button onClick={() => setNotice('Credit purchases will be available once payments are connected.')}>Get credits</button></div>
      </section>

      <section id="gallery" className="gallery-section">
        <div className="section-title"><p>02 / INSPIRATION</p><h2>Start with an idea.</h2></div>
        <div className="sample-grid">
          {samples.map(([name, text, kind], index) => <button key={name} className={'sample sample-' + index} onClick={() => { setMode(kind); setPrompt(text); document.getElementById('studio').scrollIntoView({ behavior: 'smooth' }); }}><span className="sample-kind">{kind === 'image' ? 'IMAGE' : 'VIDEO'}</span><strong>{name}</strong><i>↗</i></button>)}
        </div>
        <button className="gallery-button" onClick={() => setShowGallery(!showGallery)}>{showGallery ? 'Close gallery' : 'Open gallery'} <span>→</span></button>
        {showGallery && <div className="coming">Your personal gallery will appear here once accounts and storage are connected.</div>}
      </section>

      <section id="pricing" className="pricing"><p>SIMPLE, TRANSPARENT PRICING</p><h2>Only pay when you create.</h2><button onClick={() => setNotice('Payments will be available once Stripe is connected.')}>View plans →</button></section>
      <footer><a className="brand" href="#top"><span>✦</span> GABITOR</a><p>© 2026 Gabitor AI</p><p>AI-powered creative tools</p></footer>
    </main>
  );
}
