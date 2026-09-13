'use client';

import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';

const samples = [
  ['Neon Nights', 'A futuristic city after rain, with neon reflections across the streets', 'image', '/gallery/neon-city.png'],
  ['Prism', 'A sculptural glass perfume bottle floating above deep blue marble', 'image', '/gallery/prism-bottle.png'],
  ['Dreamscape', 'Floating islands at sunset, rendered with cinematic detail', 'image', '/gallery/floating-islands.png'],
  ['Light Forms', 'Abstract ribbons of violet, coral and lime light in motion', 'image', '/gallery/light-ribbons.png'],
  ['Studio Flow', 'A creative workspace with a holographic moodboard at dusk', 'image', '/gallery/creative-workspace.png'],
  ['Coastal Drive', 'A chrome sports car on a sunlit Italian coastal road', 'image', '/gallery/coastal-drive.png']
];

export default function Home() {
  const [mode, setMode] = useState('image');
  const [prompt, setPrompt] = useState('');
  const [notice, setNotice] = useState('');
  const [showGallery, setShowGallery] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [image, setImage] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [resolution, setResolution] = useState('768');
  const [quality, setQuality] = useState('high');
  const [user, setUser] = useState(null);
  const [credits, setCredits] = useState(null);
  const [creations, setCreations] = useState([]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !user) { setCredits(null); return; }
    let active = true;
    async function ensureProfile() {
      const { data, error } = await supabase.from('profiles').select('credits').eq('id', user.id).maybeSingle();
      if (error) { if (active) setCredits(0); return; }
      if (!data) {
        const { data: created, error: createError } = await supabase.from('profiles').insert({ id: user.id, credits: 15 }).select('credits').single();
        if (!createError) await supabase.auth.updateUser({ data: { welcome_credits_granted: true } });
        if (active) setCredits(createError ? 0 : (created?.credits ?? 15));
        return;
      }
      if ((data.credits ?? 0) === 0 && !user.user_metadata?.welcome_credits_granted) {
        const { data: updated, error: updateError } = await supabase.from('profiles').update({ credits: 15 }).eq('id', user.id).select('credits').single();
        if (!updateError) await supabase.auth.updateUser({ data: { welcome_credits_granted: true } });
        if (active) setCredits(updateError ? 0 : (updated?.credits ?? 15));
        return;
      }
      if (active) setCredits(data.credits ?? 0);
    }
    ensureProfile();
    return () => { active = false; };
  }, [user]);

  useEffect(() => {
    if (!user) { setCreations([]); return; }
    try { setCreations(JSON.parse(localStorage.getItem(`gabitor-creations-${user.id}`) || '[]')); } catch { setCreations([]); }
  }, [user]);

  async function submitAuth(event) {
    event.preventDefault();
    if (!supabase) { setAuthMessage('Account access is being configured. Please try again shortly.'); return; }
    setLoading(true); setAuthMessage('');
    const result = authMode === 'signup'
      ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
      : await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (result.error) { setAuthMessage(result.error.message); return; }
    if (authMode === 'signup' && !result.data.session) { setAuthMessage('Check your inbox to confirm your email, then sign in.'); return; }
    setAuthOpen(false); setPassword('');
    setNotice(authMode === 'signup' ? 'Your account is ready. Welcome to Gabitor.' : 'You are signed in.');
  }

  async function signOut() { await supabase?.auth.signOut(); setNotice('You have been signed out.'); }
  function openSignup() { setAuthMode('signup'); setAuthMessage(''); setAuthOpen(true); }
  async function generate() {
    if (!user) { setAuthMode('signup'); setAuthMessage('Create an account to start generating.'); setAuthOpen(true); return; }
    if (!prompt.trim()) { setNotice('Start by writing a short description.'); return; }
    setGenerating(true); setImage(''); setNotice('Creating your image…');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Please sign in again to generate.');
      const response = await fetch('/api/generate2', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ prompt: prompt.trim(), resolution, quality }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Image generation failed.');
      setImage(data.image);
      if (typeof data.remainingCredits === 'number') setCredits(data.remainingCredits);
      const creation = { id: Date.now(), image: data.image, prompt: prompt.trim(), createdAt: new Date().toISOString() };
      setCreations(previous => { const next = [creation, ...previous].slice(0, 12); try { localStorage.setItem(`gabitor-creations-${user.id}`, JSON.stringify(next)); } catch {} return next; });
      setNotice('Your image is ready.');
    } catch (error) { setNotice(error.message || 'Image generation failed. Please try again.'); }
    finally { setGenerating(false); }
  }

  return <main>
    <nav className="nav">
      <a className="brand" href="#top"><span>✦</span> GABITOR</a>
      <div className="nav-links"><a href="#studio">Studio</a><a href="#gallery">Gallery</a><a href="#pricing">Pricing</a></div>
      {user ? <div className="profile-area"><div className="profile-chip"><span className="profile-avatar">{(user.email || 'G').charAt(0).toUpperCase()}</span><span className="profile-info"><strong>{user.email}</strong><small>{credits ?? '…'} credits</small></span></div><button className="account" onClick={signOut}>Sign out</button></div> : <button className="account" onClick={() => { setAuthMode('signin'); setAuthMessage(''); setAuthOpen(true); }}>Sign in</button>}
    </nav>
    <section id="top" className="hero">
      <p className="eyebrow">AI CREATIVE STUDIO</p><h1>Create images.<br/><em>Tell stories in motion.</em></h1>
      <p className="lead">One creative studio where your ideas become visuals. Make images and videos shaped around your vision.</p>
      <a className="start" href="#studio">Start creating <span>↓</span></a>
    </section>
    <section id="studio" className="studio-wrap">
      <div className="section-title"><p>01 / STUDIO</p><h2>What will you create?</h2></div>
      <div className="studio-card"><div className="mode-row">
        <button className={mode === 'image' ? 'mode active' : 'mode'} onClick={() => setMode('image')}><span>◈</span> Image</button>
        <button className={mode === 'video' ? 'mode active' : 'mode'} onClick={() => setMode('video')}><span>▷</span> Video</button>
      </div>
      <textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={mode === 'image' ? 'Example: An elegant perfume bottle in moonlight, on deep-blue marble...' : 'Example: A vintage sports car driving slowly through a sunlit Italian village...'} />
      {showSettings && <div className="settings-panel"><label>Image size<select value={resolution} onChange={event => setResolution(event.target.value)}><option value="512">512 × 512</option><option value="768">768 × 768</option><option value="1024">1024 × 1024</option></select></label><label>Quality<select value={quality} onChange={event => setQuality(event.target.value)}><option value="standard">Standard</option><option value="high">High detail</option></select></label></div>}
      <div className="card-bottom"><button className="settings" onClick={() => setShowSettings(!showSettings)}>✧ Settings {showSettings ? '↑' : '↓'}</button><button className="generate" disabled={generating} onClick={generate}>{generating ? 'Creating…' : <>Generate <span>→</span></>}</button></div>{notice && <p className="notice">{notice}</p>}{image && <div className="result-image"><img src={image} alt="Your Gabitor creation" /><a className="download-image" href={image} download="gabitor-creation.png">↓ Download image</a></div>}</div>
      <div className="credit-line"><span>✦</span> {user ? `${credits ?? '…'} credits available` : 'Register for 15 free credits'} <button onClick={() => user ? setNotice('Credit purchases will be available once payments are connected.') : openSignup()}>{user ? 'Get credits' : 'Register now'}</button></div>
    </section>
    <section id="gallery" className="gallery-section">
      <div className="section-title"><p>02 / INSPIRATION</p><h2>Start with an idea.</h2></div><div className="sample-grid">
      {samples.map(([name, text, kind, image]) => <button key={name} className="sample" style={{ backgroundImage: `url(${image})` }} onClick={() => { setMode(kind); setPrompt(text); document.getElementById('studio').scrollIntoView({ behavior: 'smooth' }); }}><span className="sample-kind">{kind === 'image' ? 'IMAGE' : 'VIDEO'}</span><strong>{name}</strong><i>↗</i></button>)}</div>
      <button className="gallery-button" onClick={() => setShowGallery(!showGallery)}>{showGallery ? 'Close gallery' : 'Open gallery'} <span>→</span></button>
      {showGallery && <div className="my-creations"><h3>My creations</h3>{user && creations.length ? <div className="creation-grid">{creations.map(creation => <article className="creation-card" key={creation.id}><img src={creation.image} alt={creation.prompt} /><div><p>{creation.prompt}</p><a href={creation.image} download={`gabitor-${creation.id}.png`}>Download ↓</a></div></article>)}</div> : <div className="coming">{user ? 'Your generated images and videos will appear here.' : 'Sign in to save and view your creations here.'}</div>}</div>}
    </section>
    <section id="pricing" className="pricing"><p>CREDIT PACKS</p><h2>Create more. Pay less.</h2><div className="price-grid"><div className="price-card"><p>STARTER</p><h3>$10</h3><strong>50 credits</strong><span>AI image generations · Private creations · No subscription</span><button onClick={() => setNotice('Payments will be available once Stripe is connected.')}>Choose Starter →</button></div><div className="price-card popular"><p>✦ MOST POPULAR</p><h3>$25</h3><strong>150 credits</strong><span>AI image generations · Best value · No subscription</span><button onClick={() => setNotice('Payments will be available once Stripe is connected.')}>Choose Creator →</button></div><div className="price-card"><p>PRO</p><h3>$50</h3><strong>400 credits</strong><span>AI image generations · 20% more credits · No subscription</span><button onClick={() => setNotice('Payments will be available once Stripe is connected.')}>Choose Pro →</button></div></div></section>
    <footer><a className="brand" href="#top"><span>✦</span> GABITOR</a><p>© 2026 Gabitor AI</p><p>AI-powered creative tools</p></footer>
    {authOpen && <div className="auth-overlay" role="dialog" aria-modal="true" aria-label="Account access"><form className="auth-card" onSubmit={submitAuth}>
      <button type="button" className="auth-close" onClick={() => setAuthOpen(false)} aria-label="Close">×</button><p className="eyebrow">GABITOR ACCOUNT</p>
      <h2>{authMode === 'signup' ? 'Start creating.' : 'Welcome back.'}</h2><p>{authMode === 'signup' ? 'Register now and receive 15 free credits.' : 'Sign in to access your credits and creations.'}</p>
      <label>Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} required autoComplete="email" /></label>
      <label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} required minLength="6" autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} /></label>
      {authMessage && <p className="auth-message">{authMessage}</p>}<button className="generate auth-submit" disabled={loading}>{loading ? 'Please wait…' : authMode === 'signup' ? 'Create account →' : 'Sign in →'}</button>
      <button type="button" className="auth-switch" onClick={() => { setAuthMode(authMode === 'signup' ? 'signin' : 'signup'); setAuthMessage(''); }}>{authMode === 'signup' ? 'Already have an account? Sign in' : 'New to Gabitor? Create an account'}</button>
    </form></div>}
  </main>;
}
