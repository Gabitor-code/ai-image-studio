'use client';
 
import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
 
const samples = [
  ['Neon Nights', 'A futuristic city after rain, with neon reflections across the streets', 'image', '/gallery/neon-city.webp'],
  ['Prism', 'A sculptural glass perfume bottle floating above deep blue marble', 'image', '/gallery/prism-bottle.webp'],
  ['Dreamscape', 'Floating islands at sunset, rendered with cinematic detail', 'image', '/gallery/floating-islands.webp'],
  ['Light Forms', 'Abstract ribbons of violet, coral and lime light in motion', 'image', '/gallery/light-ribbons.webp'],
  ['Studio Flow', 'A creative workspace with a holographic moodboard at dusk', 'image', '/gallery/creative-workspace.webp'],
  ['Coastal Drive', 'A chrome sports car on a sunlit Italian coastal road', 'image', '/gallery/coastal-drive.webp']
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
  const [videoResolution, setVideoResolution] = useState('720p');
  const [videoTier, setVideoTier] = useState('standard');
  const [style, setStyle] = useState('None');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [referenceStrength, setReferenceStrength] = useState('0.3');
  const [duration, setDuration] = useState('5');
  const [motion, setMotion] = useState('medium');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [seed, setSeed] = useState('-1');
  const [referenceImage, setReferenceImage] = useState('');
  const [referenceName, setReferenceName] = useState('');
  const [user, setUser] = useState(null);
  const [credits, setCredits] = useState(null);
  const [creations, setCreations] = useState([]);
 
  async function readApiResponse(response) {
    const body = await response.text();
    if (!body) return {};
    try { return JSON.parse(body); }
    catch { return { error: response.ok ? 'The server returned an invalid response.' : `Server error (${response.status}). Please try again shortly.` }; }
  }
 
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
  async function buyCredits(plan) {
    if (!user) { openSignup(); return; }
    setNotice('Opening secure checkout…');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Please sign in again to purchase credits.');
      const response = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ plan }) });
      const data = await readApiResponse(response);
      if (!response.ok || !data.url) throw new Error(data.error || 'Unable to open checkout.');
      window.location.assign(data.url);
    } catch (error) { setNotice(error.message || 'Unable to open checkout.'); }
  }
  function openSignup() { setAuthMode('signup'); setAuthMessage(''); setAuthOpen(true); }
  const isVideoLike = mode === 'video' || mode === 'text-video';
  async function generate() {
    if (!user) { setAuthMode('signup'); setAuthMessage('Create an account to start generating.'); setAuthOpen(true); return; }
    if (!prompt.trim()) { setNotice('Start by writing a short description.'); return; }
    if ((mode === 'image-edit' || mode === 'video') && !referenceImage) { setNotice(mode === 'video' ? 'Upload an image to create a video.' : 'Upload a reference image for image-to-image editing.'); return; }
    setGenerating(true); setImage(''); setNotice('Creating your image…');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Please sign in again to generate.');
      const response = await fetch('/api/generate2', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ prompt: prompt.trim(), resolution, quality, videoResolution, videoTier, style, aspectRatio, referenceStrength: Number(referenceStrength), duration: Number(duration), motion, negativePrompt, seed: Number(seed), referenceImage: (mode === 'image-edit' || mode === 'video') ? referenceImage : '', workflowMode: mode === 'video' ? 'video' : mode === 'text-video' ? 'text-video' : mode === 'image-edit' ? 'edit' : 'image' }) });
      let data = await readApiResponse(response);
      if (isVideoLike && response.status === 202 && data.pending && data.jobId) {
        setNotice('Video is queued. Waiting for an available worker…');        const videoJobId = data.jobId;
        // Which API the job was submitted to - 'alibaba' (Standard tier, and
        // always for Text to video) or 'replicate' (Cinematic/Kling tier) -
        // so we poll the right one.
        const videoProvider = data.provider === 'replicate' ? 'replicate' : 'alibaba';
        const startedAt = Date.now();
        // 9 minutes: a cold worker can take 1-3 minutes just to spin up and
        // load the model before generation even starts, so 5 minutes was
        // giving up on jobs that went on to finish successfully (and had
        // already been billed for) a minute later.
        while (Date.now() - startedAt < 9 * 60 * 1000) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          const statusResponse = await fetch(`/api/video-status?jobId=${encodeURIComponent(videoJobId)}&provider=${videoProvider}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
          data = await readApiResponse(statusResponse);
          if (statusResponse.status === 202 && data.pending) { setNotice(data.status === 'IN_PROGRESS' || data.status === 'RUNNING' || data.status === 'processing' ? 'Video is being generated…' : 'Video is still queued…'); continue; }
          break;
        }
        if (!data.ready) throw new Error(data.error || 'The video is taking too long. Please try again later.');
      }
      if (!response.ok && !data.ready) throw new Error(data.error || 'Image generation failed.');
      setImage(isVideoLike ? data.video : data.image);
      if (typeof data.remainingCredits === 'number') setCredits(data.remainingCredits);
      const creation = { id: Date.now(), image: isVideoLike ? data.video : data.image, prompt: prompt.trim(), createdAt: new Date().toISOString(), kind: mode };
      setCreations(previous => { const next = [creation, ...previous].slice(0, 12); try { localStorage.setItem(`gabitor-creations-${user.id}`, JSON.stringify(next)); } catch {} return next; });
      setNotice(data.creditWarning || (isVideoLike ? 'Your video is ready.' : 'Your image is ready.'));
    } catch (error) { setNotice(error.message || 'Image generation failed. Please try again.'); }
    finally { setGenerating(false); }
  }
 
  const settingsSummary = isVideoLike ? `${videoTier === 'cinematic' ? 'Cinematic' : videoResolution} · ${duration}s` : `${resolution}px · ${quality === 'standard' ? 'Standard' : 'High detail'}`;
  // Mirrors the server-side cost table in app/api/generate2/route.js - keep
  // the two in sync. This is display-only; the API always recomputes and
  // enforces the real cost itself. Alibaba bills Standard text-to-video and
  // image-to-video at the same per-second rate, so Text to video reuses the
  // Standard tier's formula (it has no Cinematic/Kling option).
  const creditCost = isVideoLike
    ? (videoTier === 'cinematic' ? 4 : (videoResolution === '1080p' ? 8 : 5)) * (([5, 8, 10].includes(Number(duration)) ? Number(duration) : 5))
    : 2;
 
  function pillGroup(options, value, onChange) {
    return <div className="pill-group">{options.map(option => <button type="button" key={option.value} className={value === option.value ? 'pill-opt active' : 'pill-opt'} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
  }
 
  return <main>
    <nav className="nav">
      <a className="brand" href="#top"><img src="/logo.png" alt="Gabitor AI" className="brand-logo" /><span className="brand-name">GABITOR</span></a>
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
      <div className="studio-card">
      <div className="prompt-bar">
        <div className="mode-pills">
          <button className={mode === 'image' ? 'pill active' : 'pill'} onClick={() => setMode('image')}><span>◈</span> Image</button>
          <button className={mode === 'image-edit' ? 'pill active' : 'pill'} onClick={() => setMode('image-edit')}><span>◈↻</span> Image to image</button>
          <button className={mode === 'video' ? 'pill active' : 'pill'} onClick={() => setMode('video')}><span>◈▷</span> Image to video</button>
          <button className={mode === 'text-video' ? 'pill active' : 'pill'} onClick={() => setMode('text-video')}><span>▷</span> Video</button>
        </div>
        <textarea className="prompt-input" value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={mode === 'image-edit' ? 'Example: Keep the product unchanged and place it in a cinematic Halloween scene...' : mode === 'image' ? 'Example: An elegant perfume bottle in moonlight, on deep-blue marble...' : mode === 'text-video' ? 'Example: A vintage sports car driving slowly through a sunlit Italian village, cinematic light...' : 'Example: A vintage sports car driving slowly through a sunlit Italian village...'} />
        <div className="prompt-bar-bottom">
          <button type="button" className="settings-chip" onClick={() => setShowSettings(!showSettings)}>✧ {settingsSummary} <span>{showSettings ? '▲' : '▾'}</span></button>
          <span className="bar-spacer" />
          <button className="send-btn" disabled={generating} onClick={generate} aria-label="Generate">{generating ? '···' : '↑'}</button>
        </div>
      </div>
      {showSettings && <div className="settings-panel"><label>Style<select value={style} onChange={event => setStyle(event.target.value)}><option>None</option><option>Photorealistic</option><option>Cinematic</option><option>Fantasy art</option><option>Anime</option><option>Product photography</option><option>Watercolor</option></select></label>{mode !== 'video' && <label>Aspect ratio{pillGroup([{ value: '1:1', label: '1:1' }, { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }], aspectRatio, setAspectRatio)}</label>}{mode === 'video' && <p className="hint">Video aspect ratio follows your uploaded photo automatically.</p>}{(mode === 'video' || mode === 'text-video') && <label>Engine{pillGroup([{ value: 'standard', label: 'Standard' }, { value: 'cinematic', label: 'Cinematic' }], videoTier, setVideoTier)}</label>}{(mode === 'image-edit' || mode === 'video') && <div className="reference-field"><span>{mode === 'video' ? 'Source image for video' : 'Reference image'}</span><label className="upload-trigger">{referenceImage ? 'Change image' : 'Upload image'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; if (!file) return; setReferenceName(file.name); const reader = new FileReader(); reader.onload = () => setReferenceImage(String(reader.result)); reader.readAsDataURL(file); }} /></label>{referenceImage && <div className="reference-preview"><img src={referenceImage} alt="Reference preview" /><span>{referenceName}</span><button type="button" onClick={() => { setReferenceImage(''); setReferenceName(''); }}>×</button></div>}{mode === 'image-edit' && <label>Reference strength{pillGroup([{ value: '0.2', label: '20%' }, { value: '0.3', label: '30%' }, { value: '0.5', label: '50%' }, { value: '0.7', label: '70%' }], referenceStrength, setReferenceStrength)}</label>}</div>}{(mode === 'video' || mode === 'text-video') && <><label>Duration{pillGroup(videoTier === 'cinematic' ? [{ value: '5', label: '5s' }, { value: '10', label: '10s' }] : [{ value: '5', label: '5s' }, { value: '8', label: '8s' }, { value: '10', label: '10s' }], duration, setDuration)}</label><label>Motion{pillGroup([{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }], motion, setMotion)}</label></>}{mode !== 'video' && mode !== 'text-video' && <label>Image size{pillGroup([{ value: '512', label: '512' }, { value: '768', label: '768' }, { value: '1024', label: '1024' }], resolution, setResolution)}</label>}{mode !== 'video' && mode !== 'text-video' && <label>Quality{pillGroup([{ value: 'standard', label: 'Standard' }, { value: 'high', label: 'High detail' }], quality, setQuality)}</label>}{(mode === 'video' || mode === 'text-video') && videoTier === 'standard' && <label>Resolution{pillGroup([{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }], videoResolution, setVideoResolution)}</label>}{(mode === 'video' || mode === 'text-video') && videoTier === 'cinematic' && <p className="hint">Cinematic mode picks its own resolution automatically (up to 1080p).</p>}<label>Negative prompt<input value={negativePrompt} onChange={event => setNegativePrompt(event.target.value)} placeholder="What should be avoided?" /></label>{mode !== 'video' && <label>Seed<input type="number" value={seed} onChange={event => setSeed(event.target.value)} /></label>}</div>}
      {notice && <p className="notice">{notice}</p>}{image && <div className="result-image">{isVideoLike ? <video src={image} controls playsInline /> : <img src={image} alt="Your Gabitor creation" />}<a className="download-image" href={image} download={isVideoLike ? 'gabitor-video.mp4' : 'gabitor-creation.png'}>↓ Download {isVideoLike ? 'video' : 'image'}</a></div>}
      </div>
      <div className="credit-line"><span>✦</span> {user ? `This generation costs ${creditCost} credits` : `This generation costs ${creditCost} credits · Register for 15 free credits`} <button onClick={() => user ? buyCredits('creator') : openSignup()}>{user ? 'Get credits' : 'Register now'}</button></div>
    </section>
    <section id="gallery" className="gallery-section">
      <div className="section-title"><p>02 / INSPIRATION</p><h2>Start with an idea.</h2></div><div className="sample-grid">
      {samples.map(([name, text, kind, image]) => <button key={name} className="sample" style={{ backgroundImage: `url(${image})` }} onClick={() => { setMode(kind); setPrompt(text); document.getElementById('studio').scrollIntoView({ behavior: 'smooth' }); }}><span className="sample-kind">{kind === 'image' ? 'IMAGE' : 'VIDEO'}</span><strong>{name}</strong><i>↗</i></button>)}</div>
      <button className="gallery-button" onClick={() => setShowGallery(!showGallery)}>{showGallery ? 'Close gallery' : 'Open gallery'} <span>→</span></button>
      {showGallery && <div className="my-creations"><h3>My creations</h3>{user && creations.length ? <div className="creation-grid">{creations.map(creation => <article className="creation-card" key={creation.id}>{(creation.kind === 'video' || creation.kind === 'text-video') ? <video className="creation-media" src={creation.image} controls playsInline preload="metadata" /> : <img className="creation-media" src={creation.image} alt={creation.prompt} />}<div><p>{creation.prompt}</p><a href={creation.image} download={`gabitor-${creation.id}.${(creation.kind === 'video' || creation.kind === 'text-video') ? 'mp4' : 'png'}`}>Download ↓</a></div></article>)}</div> : <div className="coming">{user ? 'Your generated images and videos will appear here.' : 'Sign in to save and view your creations here.'}</div>}</div>}
    </section>
    <section id="pricing" className="pricing"><p>CREDIT PACKS</p><h2>Create more. Pay less.</h2><div className="price-grid"><div className="price-card"><p>STARTER</p><h3>$10</h3><strong>200 credits</strong><span>Images &amp; video · Private creations · No subscription</span><button onClick={() => buyCredits('starter')}>Choose Starter →</button></div><div className="price-card popular"><p>✦ MOST POPULAR</p><h3>$25</h3><strong>550 credits</strong><span>Images &amp; video · Best value · No subscription</span><button onClick={() => buyCredits('creator')}>Choose Creator →</button></div><div className="price-card"><p>PRO</p><h3>$50</h3><strong>1200 credits</strong><span>Images &amp; video · 20% more credits · No subscription</span><button onClick={() => buyCredits('pro')}>Choose Pro →</button></div></div></section>
    <footer><a className="brand" href="#top"><img src="/logo.png" alt="Gabitor AI" className="brand-logo" /><span className="brand-name">GABITOR</span></a><p>© 2026 Gabitor AI</p><p>AI-powered creative tools</p></footer>
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
