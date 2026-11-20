import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');
const DURATION = 20_000;
const DURATION_SECONDS = DURATION / 1000;
const OTP_SESSION_KEY = 'telmifast-quiz-session';
const SOUND_FILES = {
  correct: '/audio/correct.mp3',
  wrong: '/audio/fail.mp3',
  confetti: '/audio/confetti.mp3',
};

function readStoredSession() {
  try {
    const session = JSON.parse(window.localStorage.getItem(OTP_SESSION_KEY) || 'null');
    return session?.token && new Date(session.expiresAt).getTime() > Date.now() ? session : null;
  } catch { return null; }
}

function playTick() {
  if (!window.AudioContext && !window.webkitAudioContext) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.frequency.value = 520;
  gain.gain.setValueAtTime(0.03, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(); oscillator.stop(ctx.currentTime + 0.1);
}

function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 180 }, (_, index) => ({
    id: index,
    x: `${4 + ((index * 47) % 92)}%`,
    y: `${90 + (index % 8)}%`,
    delay: `${(index % 24) * 0.062}s`,
    duration: `${3.35 + (index % 7) * 0.025}s`,
    drift: `${((index * 83) % 640) - 320}px`,
    rise: `${-190 - ((index * 31) % 430)}px`,
    drop: `${280 + ((index * 47) % 330)}px`,
    spin: `${360 + (index % 4) * 180}deg`,
    color: ['#e86f31', '#f5c542', '#fff6d8', '#4fb6a7', '#7d91e8'][index % 5],
  })), []);
  return <div className="confetti" aria-hidden="true">{pieces.map((piece) => <i key={piece.id} style={{ '--x': piece.x, '--y': piece.y, '--delay': piece.delay, '--duration': piece.duration, '--drift': piece.drift, '--rise': piece.rise, '--drop': piece.drop, '--spin': piece.spin, '--color': piece.color }} />)}</div>;
}

function QuizBanner() {
  return <div className="question-banner" aria-label="Telmifast banner"><div className="question-banner-track"><img src="/images/telmifast-sticker.png" alt="Telmifast — The Fast Track to BP Control" /></div></div>;
}

function PageStickers() {
  return <div className="page-stickers" aria-hidden="true"><img className="page-top-sticker" src="/images/quiz-header-sticker.png" alt="" /><img className="page-bottom-sticker" src="/images/telmifast-sticker.png" alt="" /></div>;
}

function HighlightFastrack({ children }) {
  if (typeof children !== 'string') return children;
  const parts = children.split(/(fastrack|fast\s+track|fast(?:er|est)?)/gi);
  return <>{parts.map((part, index) => /^(fastrack|fast\s+track|fast(?:er|est)?)$/i.test(part) ? <strong className="fastrack-highlight" key={index}>{part}</strong> : part)}</>;
}

function useViewportFit(screen) {
  useLayoutEffect(() => {
    const page = document.querySelector('main.page');
    if (!page) return undefined;
    let frame = 0;
    const fit = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        page.style.setProperty('--page-fit', '1');
        page.style.setProperty('--question-fit', '1');
        // Credentials are intentionally allowed to scroll so no fields or
        // sponsor artwork are shrunk or clipped on shorter devices.
        if (page.classList.contains('form-page')) return;
        if (page.classList.contains('quiz-page')) {
          const header = page.querySelector('.quiz-header');
          const card = page.querySelector('.question-card');
          const footer = page.querySelector('.question-banner');
          if (!header || !card || !footer) return;
          const available = page.clientHeight - header.offsetHeight - footer.offsetHeight - 20;
          const bounds = card.getBoundingClientRect();
          const scale = Math.min(1, available / bounds.height, (page.clientWidth - 16) / bounds.width);
          page.style.setProperty('--question-fit', `${Math.max(.55, scale)}`);
          return;
        }
        const panel = page.querySelector(':scope > .hero-card, :scope > .form-card, :scope > .result-card, :scope > .wheel-card, :scope > .saving');
        if (!panel) return;
        const bounds = panel.getBoundingClientRect();
        const decorationSpace = page.querySelector('.page-stickers') ? 190 : 24;
        const scale = Math.min(1, (page.clientWidth - 24) / bounds.width, (page.clientHeight - decorationSpace) / bounds.height);
        page.style.setProperty('--page-fit', `${Math.max(.5, scale)}`);
      });
    };
    const observer = new ResizeObserver(fit);
    observer.observe(page);
    page.querySelectorAll(':scope > *').forEach((child) => observer.observe(child));
    const mutations = new MutationObserver(fit);
    mutations.observe(page, { childList: true, subtree: true });
    window.addEventListener('resize', fit);
    fit();
    return () => { window.cancelAnimationFrame(frame); observer.disconnect(); mutations.disconnect(); window.removeEventListener('resize', fit); };
  }, [screen]);
}

const formatTime = (seconds) => `00:${String(Math.max(0, seconds)).padStart(2, '0')}`;

function PodiumLeaderboard({ entries, refreshSeconds }) {
  const ranked = [entries[1], entries[0], entries[2]];
  const positions = [
    { rank: 2, medal: '🥈', label: 'SILVER', height: 'silver' },
    { rank: 1, medal: '👑', label: 'GOLD', height: 'gold' },
    { rank: 3, medal: '🥉', label: 'BRONZE', height: 'bronze' },
  ];
  return <section className="podium-board">
    <header className="podium-heading"><div><span className="live-dot" /> LIVE LEADERBOARD <small>ALL-TIME TOP THREE</small></div><div className="reset-clock"><span>REFRESHES IN</span><b>{String(Math.floor(refreshSeconds / 60)).padStart(2, '0')}:{String(refreshSeconds % 60).padStart(2, '0')}</b></div></header>
    <div className="podium-stage">
      {positions.map((position, positionIndex) => {
        const entry = ranked[positionIndex];
        return <div className={`podium-place ${position.height}`} key={position.rank}>
          <div className="podium-person"><span className="medal">{position.medal}</span><b>{entry?.name || 'Waiting...'}</b><small>{entry ? entry.city : 'Next challenger'}</small><strong>{entry ? entry.score : '—'}<i> pts</i></strong></div>
          <div className="podium-block"><span>{position.rank}</span><small>{position.label}</small></div>
        </div>;
      })}
    </div>
    <p className="podium-note">Top three scores of all time · refreshed every five minutes</p>
  </section>;
}

const WHEEL_COLORS = ['#ef7b3b', '#f5be3e', '#3868a9', '#4cae9b', '#d8576c', '#8263b5', '#e59d39', '#467ea1', '#c95842', '#5c9f7d', '#e8ba55', '#697ac0'];

function SpinWheelPage() {
  const [candidates, setCandidates] = useState([]);
  const [winner, setWinner] = useState('');
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [error, setError] = useState('');
  const pendingWinner = useRef('');
  const winnerSound = useRef(null);
  const spinLock = useRef(false);
  const winnerResetTimer = useRef(null);

  const wheelStyle = useMemo(() => {
    if (!candidates.length) return { '--wheel-fill': 'conic-gradient(#ef7b3b, #f5be3e, #3868a9, #4cae9b, #d8576c, #8263b5, #ef7b3b)' };
    const slice = 360 / candidates.length;
    const stops = candidates.map((_, index) => `${WHEEL_COLORS[index % WHEEL_COLORS.length]} ${index * slice}deg ${(index + 1) * slice}deg`).join(', ');
    return { '--wheel-fill': `conic-gradient(from ${-slice / 2}deg, ${stops})`, '--wheel-rotation': `${rotation}deg` };
  }, [candidates, rotation]);

  const spin = async () => {
    if (spinning || spinLock.current) return;
    spinLock.current = true;
    if (winnerResetTimer.current) window.clearTimeout(winnerResetTimer.current);
    setError('');
    setWinner('');
    setCelebrating(false);
    setSpinning(true);
    if (!winnerSound.current) {
      winnerSound.current = new Audio('/audio/confetti.mp3');
      winnerSound.current.preload = 'auto';
    }
    // Start muted on the tap to unlock delayed playback on mobile browsers.
    winnerSound.current.muted = true;
    winnerSound.current.volume = 0;
    winnerSound.current.currentTime = 0;
    winnerSound.current.play().catch(() => {});
    try {
      const response = await fetch(`${API}/spin-winner`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      const slice = 360 / data.candidates.length;
      pendingWinner.current = data.winner;
      setCandidates(data.candidates);
      setRotation((previous) => (Math.ceil(previous / 360) * 360) + (360 * 6) - (data.winnerIndex * slice));
      window.setTimeout(() => {
        setWinner(pendingWinner.current);
        setCelebrating(true);
        winnerSound.current.pause();
        winnerSound.current.currentTime = 0;
        winnerSound.current.muted = false;
        winnerSound.current.volume = 0.7;
        winnerSound.current.play().catch(() => {});
        setSpinning(false);
        spinLock.current = false;
        winnerResetTimer.current = window.setTimeout(() => {
          setWinner('');
          setCelebrating(false);
        }, 10_000);
      }, 4700);
    } catch (spinError) {
      setError(spinError.message || 'The wheel could not load participants.');
      setSpinning(false);
      spinLock.current = false;
    }
  };

  return <main className="page wheel-page">{celebrating && <Confetti />}<section className="wheel-card"><img className="wheel-brand" src="/images/fastrack-telmifast-sticker.png" alt="Fastrack with Telmifast" /><span className="eyebrow">RSSDI PARTICIPANT DRAW</span><h1>Spin the<br /><em>winner wheel.</em></h1><p className="wheel-intro">Tap the center to choose one unique quiz participant at random from the database.</p><div className="wheel-wrap"><div className="wheel-pointer" aria-hidden="true" /><div className={`spin-wheel ${spinning ? 'is-spinning' : ''}`} style={wheelStyle} /><img className="wheel-road-ring" src="/images/racing-wheel-road-ring.png" alt="" aria-hidden="true" /><button className={`wheel-hub ${winner ? 'has-winner' : ''}`} disabled={spinning || Boolean(winner)} onClick={spin} aria-label={spinning ? 'Selecting a winner' : 'Spin the winner wheel'}>{spinning ? <span>SPINNING</span> : winner ? <><small>WINNER</small><strong>{winner}</strong><em>Congratulations!</em></> : <><span>TAP TO</span><b>SPIN</b></>}</button></div>{winner && <div className="winner-sticker" aria-live="polite"><img src="/images/winner-sticker.png" alt="Winner" /><strong>{winner}</strong><span>Congratulations!</span></div>}{error && <p className="error wheel-error">{error}</p>}</section></main>;
}

function WinnerAdminPage() {
  const [adminKey, setAdminKey] = useState(() => window.sessionStorage.getItem('winner-admin-key') || '');
  const [authorized, setAuthorized] = useState(false);
  const [name, setName] = useState('');
  const [durationHours, setDurationHours] = useState(1);
  const [scheduledWinner, setScheduledWinner] = useState(null);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);

  const adminRequest = useCallback(async (url, options = {}) => {
    const response = await fetch(`${API}${url}`, {
      ...options,
      headers: { 'X-Winner-Admin-Key': adminKey, ...(options.headers || {}) },
    });
    if (response.status === 204) return null;
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Winner controls are unavailable.');
    return data;
  }, [adminKey]);

  const openControls = async () => {
    setPending(true); setMessage('');
    try {
      const data = await adminRequest('/winner-schedule');
      window.sessionStorage.setItem('winner-admin-key', adminKey);
      setScheduledWinner(data.winner);
      setAuthorized(true);
    } catch (requestError) { setMessage(requestError.message); }
    finally { setPending(false); }
  };

  const scheduleWinner = async (event) => {
    event.preventDefault();
    setPending(true); setMessage('');
    try {
      const data = await adminRequest('/winner-schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, durationHours }) });
      setScheduledWinner(data.winner); setName('');
      setMessage(`Winner scheduled for ${durationHours} hour${durationHours === 1 ? '' : 's'}.`);
    } catch (requestError) { setMessage(requestError.message); }
    finally { setPending(false); }
  };

  const removeSchedule = async () => {
    setPending(true); setMessage('');
    try {
      await adminRequest('/winner-schedule', { method: 'DELETE' });
      setScheduledWinner(null); setMessage('Scheduled winner removed. The wheel will now select randomly.');
    } catch (requestError) { setMessage(requestError.message); }
    finally { setPending(false); }
  };

  const formatExpiry = (expiresAt) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(expiresAt));

  return <main className="page winner-admin-page"><section className="winner-admin-card"><span className="eyebrow">ORGANIZER CONTROLS</span><h1>Schedule the<br /><em>wheel winner.</em></h1>{!authorized ? <><p>Enter the organizer key to manage the temporary winner shown by the spin wheel.</p><label>Organizer key<input type="password" autoComplete="current-password" value={adminKey} onChange={(event) => setAdminKey(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') openControls(); }} placeholder="Enter organizer key" /></label><button className="primary" disabled={pending || !adminKey} onClick={openControls}>{pending ? 'Opening…' : 'Open controls'}</button></> : <><p className="winner-admin-intro">Every spin will show the scheduled name until it expires. Removing it returns the wheel to a random participant.</p>{scheduledWinner ? <div className="scheduled-winner"><small>ACTIVE SCHEDULE</small><strong>{scheduledWinner.name}</strong><span>Ends {formatExpiry(scheduledWinner.expiresAt)}</span><button className="secondary" disabled={pending} onClick={removeSchedule}>Delete scheduled winner</button></div> : <div className="no-scheduled-winner">No scheduled winner. The wheel is selecting randomly.</div>}<form onSubmit={scheduleWinner}><label>Winner name<input value={name} maxLength="100" onChange={(event) => setName(event.target.value)} placeholder="Enter winner name" required /></label><fieldset><legend>Show this winner for</legend>{[1, 2, 3].map((hours) => <label key={hours}><input type="radio" name="duration" value={hours} checked={durationHours === hours} onChange={() => setDurationHours(hours)} /> {hours} hour{hours === 1 ? '' : 's'}</label>)}</fieldset><button className="primary" disabled={pending}>{pending ? 'Saving…' : 'Schedule winner'}</button></form></>}{message && <p className={message.includes('scheduled') || message.includes('randomly') ? 'auth-message' : 'error'}>{message}</p>}</section></main>;
}

function App() {
  const [screen, setScreen] = useState(() => {
    const path = window.location.pathname.replace(/\/+$/, '');
    if (window.location.hash === '#leaderboard' || path === '/leaderboard') return 'leaderboard';
    if (window.location.hash === '#spin-wheel' || path === '/spin-wheel') return 'spin';
    if (window.location.hash === '#winner' || path === '/winner') return 'winner-admin';
    return 'welcome';
  });
  const [session, setSession] = useState(readStoredSession);
  const [participant, setParticipant] = useState(() => session?.participant || { name: '', city: '', state: '', phone: '' });
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [authPending, setAuthPending] = useState(false);
  const [quiz, setQuiz] = useState([]);
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState(DURATION_SECONDS);
  const [answers, setAnswers] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [result, setResult] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [nextRefreshAt, setNextRefreshAt] = useState(null);
  const [refreshSeconds, setRefreshSeconds] = useState(300);
  const [error, setError] = useState('');
  const startedAt = useRef(0);
  const settling = useRef(false);
  const sounds = useRef({});
  const backgroundMusic = useRef(null);

  useViewportFit(screen);

  useEffect(() => {
    if (resendSeconds <= 0) return undefined;
    const timer = window.setTimeout(() => setResendSeconds((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);

  // Render serves the API from the same origin. Restore the secure server-side
  // login cookie after a reload so verified participants only see Play quiz.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/auth/session`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then((savedSession) => {
        if (cancelled || !savedSession?.verified) return;
        // Keep the locally saved bearer token when it exists.  Previously this
        // replacement dropped it and made a returning participant depend solely
        // on the HttpOnly cookie, which is not available in every deployment
        // arrangement (for example, a separate API origin).
        setSession((currentSession) => ({
          token: currentSession?.token,
          expiresAt: savedSession.expiresAt,
          participant: savedSession.participant,
        }));
        setParticipant(savedSession.participant);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const sessionActive = Boolean(session && new Date(session.expiresAt).getTime() > Date.now());
  const authHeaders = sessionActive ? { Authorization: `Bearer ${session.token}` } : {};

  const validateParticipant = () => {
    if (participant.name.trim() && participant.city.trim() && participant.state.trim() && /^\d{10}$/.test(participant.phone)) return true;
    setError('Please add your name, city, state, and a valid 10-digit phone number.');
    return false;
  };

  const clearSession = () => {
    window.localStorage.removeItem(OTP_SESSION_KEY);
    setSession(null);
    fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
  };

  const logoutForNewRegistration = () => {
    clearSession();
    setParticipant({ name: '', city: '', state: '', phone: '' });
    setOtp('');
    setOtpSent(false);
    setResendSeconds(0);
    setError('');
    setScreen('details');
  };

  const prepareSound = useCallback(() => {
    Object.entries(SOUND_FILES).forEach(([kind, source]) => {
      if (sounds.current[kind]) return;
      const audio = new Audio(source);
      audio.preload = 'auto';
      sounds.current[kind] = audio;
    });
    return sounds.current;
  }, []);

  const playSound = useCallback((kind) => {
    if (kind === 'tick') return playTick();
    const sound = prepareSound()[kind];
    sound.pause();
    sound.currentTime = 0;
    sound.play().catch(() => {});
  }, [prepareSound]);

  const prepareBackgroundMusic = useCallback(() => {
    if (!backgroundMusic.current) {
      const music = new Audio('/audio/background.mp3');
      music.loop = true;
      music.preload = 'auto';
      music.volume = 0;
      backgroundMusic.current = music;
    }
    return backgroundMusic.current;
  }, []);

  const getLeaderboard = useCallback(async () => {
    const response = await fetch(`${API}/leaderboard`);
    if (!response.ok) throw new Error('Leaderboard unavailable');
    const data = await response.json();
    setLeaderboard(data.entries);
    setNextRefreshAt(data.nextRefreshAt);
  }, []);

  useEffect(() => {
    if (!['results', 'leaderboard'].includes(screen)) return;
    getLeaderboard().catch(() => setError('Leaderboard will appear as soon as the connection is restored.'));
  }, [screen, getLeaderboard]);

  useEffect(() => {
    if (!nextRefreshAt) return;
    const update = () => setRefreshSeconds(Math.max(0, Math.ceil((new Date(nextRefreshAt) - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [nextRefreshAt]);

  useEffect(() => {
    if (!['results', 'leaderboard'].includes(screen) || !nextRefreshAt) return;
    const delay = Math.max(1000, new Date(nextRefreshAt).getTime() - Date.now() + 600);
    const timer = window.setTimeout(() => getLeaderboard().catch(() => setError('Leaderboard will appear as soon as the connection is restored.')), delay);
    return () => window.clearTimeout(timer);
  }, [screen, nextRefreshAt, getLeaderboard]);

  useEffect(() => {
    if (screen !== 'results') return;
    playSound((result?.score ?? 0) > 0 ? 'confetti' : 'wrong');
  }, [screen, result?.score, playSound]);

  useEffect(() => {
    if (screen === 'quiz') {
      const music = prepareBackgroundMusic();
      music.volume = 0.7;
      music.play().catch(() => {});
      return;
    }
    if (backgroundMusic.current) {
      backgroundMusic.current.pause();
      backgroundMusic.current.currentTime = 0;
    }
  }, [screen, prepareBackgroundMusic]);

  useEffect(() => {
    if (screen !== 'quiz' || feedback) return;
    startedAt.current = performance.now();
    const interval = window.setInterval(() => {
      const elapsed = performance.now() - startedAt.current;
      const seconds = Math.max(0, Math.ceil((DURATION - elapsed) / 1000));
      setRemaining(seconds);
      if (seconds > 0 && seconds <= 5 && Math.floor(elapsed / 1000) !== Math.floor((elapsed - 80) / 1000)) playSound('tick');
      if (elapsed >= DURATION) resolveAnswer(null, DURATION);
    }, 80);
    return () => window.clearInterval(interval);
  // resolveAnswer is deliberately re-created; quiz state is fixed while a question is live.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, index, feedback]);

  const requestOtp = async () => {
    setError('');
    if (otpSent && resendSeconds > 0) return;
    if (!validateParticipant()) return;
    setAuthPending(true);
    try {
      const response = await fetch(`${API}/auth/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(participant),
        credentials: 'include',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      setOtpSent(true);
      setResendSeconds(15);
      setOtp('');
      setError(data.delivery === 'fallback' ? 'SMS is unavailable. Enter the organizer fallback OTP to continue.' : 'OTP sent by SMS. Enter it below to verify your phone.');
    } catch (authError) {
      setError(authError.message || 'Could not send the OTP. Please try again.');
    } finally { setAuthPending(false); }
  };

  const verifyOtp = async () => {
    setError('');
    if (!validateParticipant()) return;
    if (!otpSent) { setError('Please send an OTP first.'); return; }
    if (!/^\d{4,8}$/.test(otp)) { setError('Enter the OTP you received.'); return; }
    setAuthPending(true);
    try {
      const response = await fetch(`${API}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: participant.phone, code: otp }),
        credentials: 'include',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      const nextSession = { token: data.token, expiresAt: data.expiresAt, participant: data.participant };
      window.localStorage.setItem(OTP_SESSION_KEY, JSON.stringify(nextSession));
      setSession(nextSession);
      setParticipant(data.participant);
      await startQuiz(nextSession, data.participant);
    } catch (authError) {
      setError(authError.message || 'Could not verify the OTP. Please try again.');
    } finally { setAuthPending(false); }
  };

  const startQuiz = async (activeSession = session) => {
    setError('');
    if (new Date(activeSession?.expiresAt).getTime() <= Date.now()) { setError('Verify the OTP to log in before starting the challenge.'); return; }
    // Preload the provided feedback tracks while the browser has a user gesture.
    prepareSound();
    // Start silently during the tap so mobile browsers permit the quiz music on the next screen.
    const music = prepareBackgroundMusic();
    music.volume = 0;
    music.play().catch(() => {});
    try {
      const response = await fetch(`${API}/quiz`, { headers: activeSession.token ? { Authorization: `Bearer ${activeSession.token}` } : {}, credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      setQuiz(data.questions); setAnswers([]); setIndex(0); setRemaining(DURATION_SECONDS); setScreen('quiz');
    } catch (quizError) {
      music.pause();
      music.currentTime = 0;
      setError(quizError.message || 'Quiz is not available yet. Please check the server connection.');
    }
  };

  const finishQuiz = async (finalAnswers) => {
    setScreen('saving');
    try {
      const response = await fetch(`${API}/submissions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ answers: finalAnswers }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      setResult(data); setScreen('results');
    } catch (submitError) { setError(submitError.message || 'Could not save this quiz.'); setScreen('quiz'); }
  };

  const resolveAnswer = async (answer, elapsedOverride) => {
    if (settling.current || !quiz[index]) return;
    settling.current = true;
    const elapsedMs = elapsedOverride ?? Math.min(DURATION, performance.now() - startedAt.current);
    const item = { questionId: quiz[index].id, answer, elapsedMs };
    let correct = false;
    if (answer) {
      try {
        const response = await fetch(`${API}/check-answer`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify(item) });
        correct = response.ok && (await response.json()).correct;
      } catch { /* scoring remains verified by the final submission */ }
    }
    const nextAnswers = [...answers, item];
    setAnswers(nextAnswers);
    setFeedback(answer ? { answer, correct, message: correct ? 'Correct answer!' : 'Not quite — next question!' } : { message: "Time's up" });
    playSound(correct ? 'correct' : 'wrong');
    window.setTimeout(() => {
      setFeedback(null); settling.current = false;
      if (index === quiz.length - 1) finishQuiz(nextAnswers); else { setIndex((value) => value + 1); setRemaining(DURATION_SECONDS); }
    }, 700);
  };

  const current = quiz[index];
  const scorePotential = useMemo(() => Math.max(1, Math.ceil(10 - (DURATION_SECONDS - remaining) / 2)), [remaining]);

  if (screen === 'welcome') return <main className="page welcome"><div className="glow glow-one" /><div className="hero-card"><div className="hero-art"><img className="home-quiz-banner" src="/images/home-quiz-banner.png" alt="Fastrack with Telmifast Quiz Contest" /><img className="home-linux-logo home-linux-desktop" src="/images/linux-laboratories-logo.png" alt="Linux Laboratories" /><div className="road">THE <HighlightFastrack>FAST TRACK</HighlightFastrack> TO BP CONTROL</div></div><div className="hero-copy"><span className="eyebrow">CARDIO–DIABETES CHALLENGE</span><h1>Think <HighlightFastrack>fast</HighlightFastrack>.<br /><em>Make every second count.</em></h1><p>10 clinical questions. 20 seconds each. <HighlightFastrack>Faster</HighlightFastrack> correct answers earn more points.</p>{sessionActive ? <><button className="primary" onClick={() => startQuiz()}>Play quiz <span>→</span></button><p className="verified-returning">✓ You&apos;re verified. Your saved session is ready.</p><button className="logout-home" onClick={logoutForNewRegistration}>Log out / register new user</button>{error && <p className="error welcome-error">{error}</p>}</> : <button className="primary" onClick={() => { setParticipant({ name: '', city: '', state: '', phone: '' }); setOtp(''); setOtpSent(false); setResendSeconds(0); setError(''); setScreen('details'); }}>Touch to start <span>→</span></button>}<img className="home-linux-logo home-linux-mobile" src="/images/linux-laboratories-logo.png" alt="Linux Laboratories" /></div></div></main>;

  if (screen === 'details') return <main className="page form-page"><PageStickers /><section className="form-card"><button className="back" onClick={() => setScreen('welcome')}>← Back</button><span className="eyebrow">WELCOME, CHALLENGER</span><h1>Before we begin</h1><p>Get Ready with your Credentials<br />on <HighlightFastrack>Fast Track</HighlightFastrack> with Telmifast!</p><label>Full name<input autoComplete="name" placeholder="Your name" value={participant.name} disabled={sessionActive} onChange={(event) => setParticipant({ ...participant, name: event.target.value })} /></label><label>City<input placeholder="Your city" value={participant.city} disabled={sessionActive} onChange={(event) => setParticipant({ ...participant, city: event.target.value })} /></label><label>State<input autoComplete="address-level1" placeholder="Your state" value={participant.state} disabled={sessionActive} onChange={(event) => setParticipant({ ...participant, state: event.target.value })} /></label><label>Phone number<input inputMode="numeric" autoComplete="tel" maxLength="10" placeholder="9876543210" value={participant.phone} disabled={sessionActive} onChange={(event) => setParticipant({ ...participant, phone: event.target.value.replace(/\D/g, '').slice(0, 10) })} /></label>{!sessionActive && <><label>OTP<input inputMode="numeric" autoComplete="one-time-code" maxLength="8" placeholder="Enter OTP" value={otp} disabled={!otpSent || authPending} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 8))} /></label><div className="otp-actions"><button className="secondary" disabled={authPending || (otpSent && resendSeconds > 0)} onClick={requestOtp}>{authPending ? 'Sending…' : otpSent && resendSeconds > 0 ? `Resend OTP (${resendSeconds}s)` : otpSent ? 'Resend OTP' : 'Send OTP'}</button><button className="primary" disabled={authPending || !otpSent} onClick={verifyOtp}>{authPending ? 'Verifying…' : 'Verify & login'}</button></div><p className="otp-note">If SMS cannot be received, use the organizer fallback OTP.</p></>}{error && <p className={error.startsWith('OTP sent') || error.startsWith('SMS is unavailable') ? 'auth-message' : 'error'}>{error}</p>}</section></main>;

  if (screen === 'saving') return <main className="page"><div className="saving"><div className="spinner" /><h2>Calculating your score…</h2><p>Saving your place on the board.</p></div></main>;

  if (screen === 'spin') return <SpinWheelPage />;

  if (screen === 'winner-admin') return <WinnerAdminPage />;

  if (screen === 'leaderboard') return <main className="page results-page"><section className="result-card leaderboard-page"><img className="leaderboard-brand" src="/images/fastrack-telmifast-sticker.png" alt="Fastrack with Telmifast" /><img className="leaderboard-hero" src="/images/live-leaderboard-header.png" alt="Live Leader Board" /><PodiumLeaderboard entries={leaderboard} refreshSeconds={refreshSeconds} />{error && <p className="error">{error}</p>}</section></main>;

  if (screen === 'results') return <main className="page results-page">{(result?.score ?? 0) > 0 && <Confetti />}<section className="result-card"><img className="score-thankyou-logo" src="/images/thankyou-quiz.png" alt="Thank you for participating in the Telmifast Quiz Contest" /><span className="eyebrow">QUIZ COMPLETE</span><h1>Great pace, {participant.name.split(' ')[0]}!</h1><div className="score-ring"><strong>{result?.score ?? 0}</strong><span>out of 100</span></div><p><b>{result?.correctCount ?? 0}/10</b> correct answers. Your score rewards accuracy and speed.</p><button className="secondary login-again" onClick={() => startQuiz()}>Play quiz again</button>{error && <p className="error">{error}</p>}</section></main>;

  return <main className="page quiz-page"><header className="quiz-header"><img className="question-logo" src="/images/quiz-header-sticker.png" alt="Fastrack with Telmifast Quiz Contest" /><span>QUESTION {index + 1}<small>/ 10</small></span><div className={`timer header-timer ${remaining <= 3 ? 'urgent' : ''}`}><i style={{ '--progress': `${(remaining / DURATION_SECONDS) * 100}%` }} /><b>{formatTime(remaining)}</b></div></header><section className="question-card"><div className="progress"><i style={{ width: `${((index + 1) / 10) * 100}%` }} /></div><div className="question-number">QUESTION {String(index + 1).padStart(2, '0')} <span>UP TO {scorePotential} POINTS</span></div><div className={`timer card-timer ${remaining <= 3 ? 'urgent' : ''}`}><i style={{ '--progress': `${(remaining / DURATION_SECONDS) * 100}%` }} /><b>{formatTime(remaining)}</b></div><h1><HighlightFastrack>{current?.question}</HighlightFastrack></h1><div className="answers">{current && Object.entries(current.options).map(([key, text]) => <button disabled={Boolean(feedback)} className={feedback?.answer === key ? (feedback.correct ? 'selected is-correct' : 'selected is-wrong') : ''} key={key} onClick={() => resolveAnswer(key)}><b>{key}</b><span><HighlightFastrack>{text}</HighlightFastrack></span></button>)}</div>{feedback && <div className="feedback">{feedback.message}</div>}</section><QuizBanner /></main>;
}

createRoot(document.getElementById('root')).render(<App />);
