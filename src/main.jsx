import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');
const DURATION = 10_000;
const SOUND_FILES = {
  correct: '/audio/correct.mp3',
  wrong: '/audio/fail.mp3',
  confetti: '/audio/confetti.mp3',
};

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

function App() {
  const [screen, setScreen] = useState(() => window.location.hash === '#leaderboard' ? 'leaderboard' : 'welcome');
  const [participant, setParticipant] = useState({ name: '', city: '', phone: '' });
  const [quiz, setQuiz] = useState([]);
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState(10);
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
    if (screen === 'results') playSound('confetti');
  }, [screen, playSound]);

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

  const startQuiz = async () => {
    setError('');
    if (!participant.name.trim() || !participant.city.trim() || !/^\d{10}$/.test(participant.phone)) {
      setError('Please add your name, city, and a valid 10-digit phone number.'); return;
    }
    // Preload the provided feedback tracks while the browser has a user gesture.
    prepareSound();
    try {
      const response = await fetch(`${API}/quiz`);
      if (!response.ok) throw new Error();
      const data = await response.json();
      setQuiz(data.questions); setAnswers([]); setIndex(0); setRemaining(10); setScreen('quiz');
    } catch { setError('Quiz is not available yet. Please check the server connection.'); }
  };

  const finishQuiz = async (finalAnswers) => {
    setScreen('saving');
    try {
      const response = await fetch(`${API}/submissions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...participant, answers: finalAnswers }) });
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
        const response = await fetch(`${API}/check-answer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
        correct = response.ok && (await response.json()).correct;
      } catch { /* scoring remains verified by the final submission */ }
    }
    const nextAnswers = [...answers, item];
    setAnswers(nextAnswers);
    setFeedback(answer ? { answer, message: correct ? 'Correct answer!' : 'Not quite — next question!' } : { message: "Time's up" });
    playSound(correct ? 'correct' : 'wrong');
    window.setTimeout(() => {
      setFeedback(null); settling.current = false;
      if (index === quiz.length - 1) finishQuiz(nextAnswers); else { setIndex((value) => value + 1); setRemaining(10); }
    }, 700);
  };

  const current = quiz[index];
  const scorePotential = useMemo(() => Math.max(1, Math.ceil(remaining)), [remaining]);

  if (screen === 'welcome') return <main className="page welcome"><div className="glow glow-one" /><div className="hero-card"><div className="hero-art"><div className="brand"><span className="heart">♡</span><span>Telmi<span>fast</span></span></div><div className="molecule">+</div><p>RSSDI MEDICAL QUIZ</p><div className="road">THE <i>FAST</i> TRACK TO BP CONTROL</div></div><div className="hero-copy"><span className="eyebrow">CARDIO–DIABETES CHALLENGE</span><h1>Think fast.<br /><em>Make every second count.</em></h1><p>10 clinical questions. 10 seconds each. Faster correct answers earn more points.</p><button className="primary" onClick={() => setScreen('details')}>Touch to start <span>→</span></button></div></div></main>;

  if (screen === 'details') return <main className="page form-page"><section className="form-card"><button className="back" onClick={() => setScreen('welcome')}>← Back</button><span className="eyebrow">WELCOME, CHALLENGER</span><h1>Before we begin</h1><p>Enter your details to join the five-minute leaderboard.</p><label>Full name<input autoComplete="name" placeholder="Your name" value={participant.name} onChange={(event) => setParticipant({ ...participant, name: event.target.value })} /></label><label>City<input placeholder="Your city" value={participant.city} onChange={(event) => setParticipant({ ...participant, city: event.target.value })} /></label><label>Phone number<input inputMode="numeric" autoComplete="tel" maxLength="10" placeholder="9876543210" value={participant.phone} onChange={(event) => setParticipant({ ...participant, phone: event.target.value.replace(/\D/g, '').slice(0, 10) })} /></label>{error && <p className="error">{error}</p>}<button className="primary full" onClick={startQuiz}>Start the challenge <span>→</span></button></section></main>;

  if (screen === 'saving') return <main className="page"><div className="saving"><div className="spinner" /><h2>Calculating your score…</h2><p>Saving your place on the board.</p></div></main>;

  if (screen === 'leaderboard') return <main className="page results-page"><section className="result-card leaderboard-page"><span className="eyebrow">TELMIFAST × RSSDI</span><h1>Champions<br /><em>of this round.</em></h1><PodiumLeaderboard entries={leaderboard} refreshSeconds={refreshSeconds} />{error && <p className="error">{error}</p>}</section></main>;

  if (screen === 'results') return <main className="page results-page"><Confetti /><section className="result-card"><span className="eyebrow">QUIZ COMPLETE</span><h1>Great pace, {participant.name.split(' ')[0]}!</h1><div className="score-ring"><strong>{result?.score ?? 0}</strong><span>out of 100</span></div><p><b>{result?.correctCount ?? 0}/10</b> correct answers. Your score rewards accuracy and speed.</p>{error && <p className="error">{error}</p>}<button className="secondary" onClick={() => { setResult(null); setError(''); setScreen('welcome'); }}>Play another round</button></section></main>;

  return <main className="page quiz-page"><header className="quiz-header"><div className="mini-brand">♡ <b>Telmi<span>fast</span></b></div><span>QUESTION {index + 1}<small>/ 10</small></span><div className={`timer ${remaining <= 3 ? 'urgent' : ''}`}><i style={{ '--progress': `${(remaining / 10) * 100}%` }} /><b>{formatTime(remaining)}</b></div></header><section className="question-card"><div className="progress"><i style={{ width: `${((index + 1) / 10) * 100}%` }} /></div><div className="question-number">QUESTION {String(index + 1).padStart(2, '0')} <span>UP TO {scorePotential} POINTS</span></div><h1>{current?.question}</h1><div className="answers">{current && Object.entries(current.options).map(([key, text]) => <button disabled={Boolean(feedback)} className={feedback?.answer === key ? 'selected' : ''} key={key} onClick={() => resolveAnswer(key)}><b>{key}</b><span>{text}</span></button>)}</div>{feedback && <div className="feedback">{feedback.message}</div>}</section></main>;
}

createRoot(document.getElementById('root')).render(<App />);
