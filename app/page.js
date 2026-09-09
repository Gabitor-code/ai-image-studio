'use client';

import { useState } from 'react';

const samples = [
  ['Neon Nights', 'Egy futurisztikus város eső után, tükröződő neonfényekkel', 'image'],
  ['Product Film', 'Prémium termékbemutató, lágy stúdiófényekkel', 'video'],
  ['Dreamscape', 'Lebegő szigetek naplementében, filmszerű részletességgel', 'image']
];

export default function Home() {
  const [mode, setMode] = useState('image');
  const [prompt, setPrompt] = useState('');
  const [notice, setNotice] = useState('');
  const [showGallery, setShowGallery] = useState(false);

  function generate() {
    if (!prompt.trim()) {
      setNotice('Írj először egy rövid leírást.');
      return;
    }
    setNotice('A generálási rendszer hamarosan itt fog elindulni.');
  }

  return (
    <main>
      <nav className="nav">
        <a className="brand" href="#top"><span>✦</span> AURA</a>
        <div className="nav-links"><a href="#studio">Stúdió</a><a href="#gallery">Galéria</a><a href="#pricing">Csomagok</a></div>
        <button className="account" onClick={() => setNotice('A bejelentkezés a Supabase bekötése után aktiválódik.')}>Belépés</button>
      </nav>

      <section id="top" className="hero">
        <p className="eyebrow">AI CREATIVE STUDIO</p>
        <h1>Alkoss képet.<br/><em>Mesélj videóval.</em></h1>
        <p className="lead">Egyetlen stúdió, ahol az ötleteidből látvány születik. Képek és videók, a saját elképzelésedre formálva.</p>
        <a className="start" href="#studio">Kezdj alkotni <span>↓</span></a>
        <div className="orb orb-one"/><div className="orb orb-two"/>
      </section>

      <section id="studio" className="studio-wrap">
        <div className="section-title"><p>01 / STÚDIÓ</p><h2>Mit képzelsz el?</h2></div>
        <div className="studio-card">
          <div className="mode-row">
            <button className={mode === 'image' ? 'mode active' : 'mode'} onClick={() => setMode('image')}><span>◈</span> Kép</button>
            <button className={mode === 'video' ? 'mode active' : 'mode'} onClick={() => setMode('video')}><span>▷</span> Videó</button>
          </div>
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder={mode === 'image' ? 'Például: Egy elegáns parfümös üveg holdfényben, sötétkék márványon...' : 'Például: Egy vintage sportautó lassan áthajt egy napfényes olasz falun...'} />
          <div className="card-bottom"><button className="settings">✧ Beállítások</button><button className="generate" onClick={generate}>Generálás <span>→</span></button></div>
          {notice && <p className="notice">{notice}</p>}
        </div>
        <div className="credit-line"><span>✦</span> 15 kredit rendelkezésedre áll <button onClick={() => setNotice('A kreditvásárlás a fizetési rendszer bekötése után aktiválódik.')}>Kreditek</button></div>
      </section>

      <section id="gallery" className="gallery-section">
        <div className="section-title"><p>02 / INSPIRÁCIÓ</p><h2>Indulj egy ötletből.</h2></div>
        <div className="sample-grid">
          {samples.map(([name, text, kind], index) => <button key={name} className={'sample sample-' + index} onClick={() => { setMode(kind); setPrompt(text); document.getElementById('studio').scrollIntoView({ behavior: 'smooth' }); }}><span className="sample-kind">{kind === 'image' ? 'KÉP' : 'VIDEÓ'}</span><strong>{name}</strong><i>↗</i></button>)}
        </div>
        <button className="gallery-button" onClick={() => setShowGallery(!showGallery)}>{showGallery ? 'Galéria bezárása' : 'Galéria megnyitása'} <span>→</span></button>
        {showGallery && <div className="coming">A személyes galériád a fiók és tárhely bekötése után jelenik meg itt.</div>}
      </section>

      <section id="pricing" className="pricing"><p>EGYSZERŰ, ÁTLÁTHATÓ</p><h2>Csak akkor fizetsz, amikor alkotsz.</h2><button onClick={() => setNotice('A fizetés a Stripe bekötése után lesz elérhető.')}>Csomagok megtekintése →</button></section>
      <footer><a className="brand" href="#top"><span>✦</span> AURA</a><p>© 2026 Aura Studio</p><p>AI-alapú kreatív eszközök</p></footer>
    </main>
  );
}
