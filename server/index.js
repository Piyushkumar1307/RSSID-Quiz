import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import pg from 'pg';
import path from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import twilio from 'twilio';
import { questions } from './questions.js';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3001);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined });
const OTP_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 10 * 60 * 60 * 1000;
const OTP_FALLBACK_CODE = process.env.OTP_FALLBACK_CODE || '2345';
const OTP_FALLBACK_ENABLED = process.env.OTP_ALLOW_FALLBACK !== 'false';
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

app.use(cors());
app.use(express.json({ limit: '32kb' }));

const currentWindow = () => {
  const now = new Date();
  const fiveMinutes = 5 * 60 * 1000;
  return new Date(Math.floor(now.getTime() / fiveMinutes) * fiveMinutes);
};

async function setupDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quiz_submissions (
      id BIGSERIAL PRIMARY KEY,
      participant_name VARCHAR(100) NOT NULL,
      city VARCHAR(100) NOT NULL,
      state VARCHAR(100),
      phone VARCHAR(25) NOT NULL,
      score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
      correct_count SMALLINT NOT NULL CHECK (correct_count >= 0 AND correct_count <= 10),
      window_start TIMESTAMPTZ NOT NULL,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS quiz_submissions_window_score_idx
      ON quiz_submissions (window_start, score DESC, submitted_at ASC);
    CREATE INDEX IF NOT EXISTS quiz_submissions_all_time_score_idx
      ON quiz_submissions (score DESC, submitted_at ASC);
    ALTER TABLE quiz_submissions ADD COLUMN IF NOT EXISTS state VARCHAR(100);
    CREATE TABLE IF NOT EXISTS otp_challenges (
      phone VARCHAR(10) PRIMARY KEY,
      participant_name VARCHAR(100) NOT NULL,
      city VARCHAR(100) NOT NULL,
      state VARCHAR(100) NOT NULL,
      code_hash TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts SMALLINT NOT NULL DEFAULT 0,
      uses_twilio_verify BOOLEAN NOT NULL DEFAULT FALSE,
      fallback_allowed BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS quiz_sessions (
      token_hash TEXT PRIMARY KEY,
      phone VARCHAR(10) NOT NULL,
      participant_name VARCHAR(100) NOT NULL,
      city VARCHAR(100) NOT NULL,
      state VARCHAR(100) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS quiz_sessions_phone_idx ON quiz_sessions (phone, expires_at DESC);
  `);
}

const digest = (value) => createHash('sha256').update(value).digest('hex');
const phoneE164 = (phone) => `+91${phone}`;
const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

function cleanParticipant(payload = {}) {
  const name = typeof payload.name === 'string' ? payload.name.trim().replace(/\s+/g, ' ') : '';
  const city = typeof payload.city === 'string' ? payload.city.trim().replace(/\s+/g, ' ') : '';
  const state = typeof payload.state === 'string' ? payload.state.trim().replace(/\s+/g, ' ') : '';
  const phone = typeof payload.phone === 'string' ? payload.phone.trim() : '';
  if (!name || !city || !state || !/^\d{10}$/.test(phone)) return null;
  return { name: name.slice(0, 100), city: city.slice(0, 100), state: state.slice(0, 100), phone };
}

function authenticationToken(request) {
  const authorization = request.get('authorization') || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

async function requireSession(req, res, next) {
  try {
    const token = authenticationToken(req);
    if (!token) return res.status(401).json({ message: 'Please log in with OTP before starting the quiz.' });
    const tokenHash = digest(token);
    const { rows } = await pool.query(
      `SELECT token_hash, phone, participant_name, city, state, expires_at, used_at
       FROM quiz_sessions WHERE token_hash = $1 AND expires_at > now()`,
      [tokenHash],
    );
    if (!rows[0]) return res.status(401).json({ message: 'Your 10-hour login has expired. Please log in again.' });
    req.quizSession = rows[0];
    next();
  } catch (error) { next(error); }
}

function publicQuestion(question) {
  return { id: question.id, question: question.question, options: question.options };
}

app.post('/api/auth/request-otp', async (req, res, next) => {
  try {
    const participant = cleanParticipant(req.body);
    if (!participant) return res.status(400).json({ message: 'Please provide a name, city, state, and a valid 10-digit phone number.' });

    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    let codeHash = null;
    let usesTwilioVerify = false;
    let delivery = 'fallback';
    let twilioError = null;

    try {
      if (twilioClient && process.env.TWILIO_VERIFY_SERVICE_SID) {
        await twilioClient.verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID).verifications.create({
          to: phoneE164(participant.phone),
          channel: 'sms',
        });
        usesTwilioVerify = true;
        delivery = 'sms';
      } else if (twilioClient && (process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_MESSAGING_SERVICE_SID)) {
        const code = String(Math.floor(100000 + Math.random() * 900000));
        await twilioClient.messages.create({
          to: phoneE164(participant.phone),
          body: `Your Telmifast Quiz OTP is ${code}. It expires in 10 minutes.`,
          ...(process.env.TWILIO_MESSAGING_SERVICE_SID
            ? { messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID }
            : { from: process.env.TWILIO_PHONE_NUMBER }),
        });
        codeHash = digest(code);
        delivery = 'sms';
      }
    } catch (error) {
      twilioError = error;
      if (!OTP_FALLBACK_ENABLED) throw error;
      console.warn('OTP delivery failed; organizer fallback remains available.', error.message);
    }

    if (delivery === 'fallback' && !OTP_FALLBACK_ENABLED) {
      return res.status(503).json({ message: 'OTP delivery is not configured. Please contact the organizer.' });
    }

    await pool.query(
      `INSERT INTO otp_challenges (phone, participant_name, city, state, code_hash, expires_at, attempts, uses_twilio_verify, fallback_allowed)
       VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8)
       ON CONFLICT (phone) DO UPDATE SET
         participant_name = EXCLUDED.participant_name, city = EXCLUDED.city, state = EXCLUDED.state,
         code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0,
         uses_twilio_verify = EXCLUDED.uses_twilio_verify, fallback_allowed = EXCLUDED.fallback_allowed,
         created_at = now()`,
      [participant.phone, participant.name, participant.city, participant.state, codeHash, expiresAt, usesTwilioVerify, OTP_FALLBACK_ENABLED],
    );

    res.json({ sent: true, delivery, expiresAt: expiresAt.toISOString(), fallbackAvailable: OTP_FALLBACK_ENABLED, deliveryWarning: Boolean(twilioError) });
  } catch (error) { next(error); }
});

app.post('/api/auth/verify-otp', async (req, res, next) => {
  try {
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!/^\d{10}$/.test(phone) || !/^\d{4,8}$/.test(code)) return res.status(400).json({ message: 'Enter your 10-digit phone number and the OTP.' });

    const { rows } = await pool.query('SELECT * FROM otp_challenges WHERE phone = $1', [phone]);
    const challenge = rows[0];
    if (!challenge || new Date(challenge.expires_at).getTime() < Date.now()) {
      await pool.query('DELETE FROM otp_challenges WHERE phone = $1', [phone]);
      return res.status(400).json({ message: 'Your OTP has expired. Please request a new code.' });
    }
    if (challenge.attempts >= 5) return res.status(429).json({ message: 'Too many OTP attempts. Please request a new code.' });

    let approved = Boolean(challenge.fallback_allowed) && OTP_FALLBACK_ENABLED && safeEqual(code, OTP_FALLBACK_CODE);
    if (!approved && challenge.uses_twilio_verify && twilioClient && process.env.TWILIO_VERIFY_SERVICE_SID) {
      const verification = await twilioClient.verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID).verificationChecks.create({
        to: phoneE164(phone),
        code,
      });
      approved = verification.status === 'approved';
    } else if (!approved && challenge.code_hash) {
      approved = safeEqual(digest(code), challenge.code_hash);
    }

    if (!approved) {
      await pool.query('UPDATE otp_challenges SET attempts = attempts + 1 WHERE phone = $1', [phone]);
      return res.status(400).json({ message: 'That OTP is not correct. Please try again.' });
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = digest(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await pool.query('DELETE FROM otp_challenges WHERE phone = $1', [phone]);
    await pool.query('DELETE FROM quiz_sessions WHERE expires_at <= now()');
    await pool.query(
      `INSERT INTO quiz_sessions (token_hash, phone, participant_name, city, state, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tokenHash, phone, challenge.participant_name, challenge.city, challenge.state, expiresAt],
    );
    res.json({ token, expiresAt: expiresAt.toISOString(), participant: { name: challenge.participant_name, city: challenge.city, state: challenge.state, phone } });
  } catch (error) { next(error); }
});

app.get('/api/quiz', requireSession, (req, res) => {
  if (req.quizSession.used_at) return res.status(409).json({ message: 'This login has already been used for one quiz. Please log in again to play another round.' });
  const selected = [...questions].sort(() => Math.random() - 0.5).slice(0, 10).map(publicQuestion);
  res.json({ questions: selected, durationSeconds: 20, maxScorePerQuestion: 10 });
});

app.post('/api/check-answer', requireSession, (req, res) => {
  const question = questions.find((item) => item.id === Number(req.body?.questionId));
  if (!question || !['A', 'B', 'C', 'D'].includes(req.body?.answer)) return res.status(400).json({ message: 'Invalid answer.' });
  res.json({ correct: question.answer === req.body.answer });
});

app.get('/api/leaderboard', async (_req, res, next) => {
  try {
    const windowStart = currentWindow();
    const { rows } = await pool.query(
      `SELECT participant_name AS name, city, score, correct_count
       FROM quiz_submissions
       ORDER BY score DESC, submitted_at ASC
       LIMIT 3`,
    );
    res.json({ entries: rows, windowStart: windowStart.toISOString(), nextRefreshAt: new Date(windowStart.getTime() + 300000).toISOString() });
  } catch (error) { next(error); }
});

app.post('/api/spin-winner', async (_req, res, next) => {
  try {
    // The database randomizes the eligible unique participant names; the first is the winner.
    const { rows } = await pool.query(
      `SELECT participant_name AS name
       FROM quiz_submissions
       GROUP BY participant_name
       ORDER BY random()
       LIMIT 12`,
    );
    if (!rows.length) return res.status(404).json({ message: 'No quiz participants are available for the wheel yet.' });
    const candidates = rows.map((row) => row.name);
    res.json({ candidates, winner: candidates[0], winnerIndex: 0 });
  } catch (error) { next(error); }
});

app.post('/api/submissions', requireSession, async (req, res, next) => {
  try {
    const { answers } = req.body ?? {};
    const { participant_name: cleanName, city: cleanCity, state: cleanState, phone: cleanPhone, token_hash: tokenHash } = req.quizSession;
    if (!Array.isArray(answers) || answers.length !== 10 || new Set(answers.map((item) => item?.questionId)).size !== 10) {
      return res.status(400).json({ message: 'A complete quiz submission is required.' });
    }

    const questionMap = new Map(questions.map((question) => [question.id, question]));
    let score = 0;
    let correctCount = 0;
    for (const response of answers) {
      const question = questionMap.get(Number(response?.questionId));
      // A timed-out question is submitted as `null` and earns zero points.
      if (!question || (response?.answer !== null && !['A', 'B', 'C', 'D'].includes(response?.answer))) {
        return res.status(400).json({ message: 'One or more answers are invalid.' });
      }
      if (response.answer === question.answer) {
        correctCount += 1;
        const elapsedMs = Math.max(0, Math.min(20000, Number(response.elapsedMs) || 20000));
        score += Math.max(1, Math.ceil(10 - elapsedMs / 2000));
      }
    }
    const windowStart = currentWindow();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const claimed = await client.query(
        `UPDATE quiz_sessions SET used_at = now()
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
         RETURNING token_hash`,
        [tokenHash],
      );
      if (!claimed.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'This login has already been used. Please log in again to play another round.' });
      }
      await client.query(
        `INSERT INTO quiz_submissions (participant_name, city, state, phone, score, correct_count, window_start)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [cleanName, cleanCity, cleanState, cleanPhone, score, correctCount, windowStart],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    res.status(201).json({ score, correctCount, windowStart: windowStart.toISOString(), nextRefreshAt: new Date(windowStart.getTime() + 300000).toISOString() });
  } catch (error) { next(error); }
});

// `npm run build && npm start` serves the finished front end from this same server.
app.use(express.static('dist'));
// Keep direct links to client-side screens working after deployment or refresh.
app.get('/{*splat}', (_req, res) => res.sendFile(path.resolve('dist/index.html')));

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ message: 'The quiz server could not reach the leaderboard. Please try again.' });
});

setupDatabase().then(() => app.listen(port, () => console.log(`Quiz API listening at http://localhost:${port}`))).catch((error) => {
  console.error('Database setup failed. Add DATABASE_URL to .env before starting the server.', error.message);
  process.exit(1);
});
