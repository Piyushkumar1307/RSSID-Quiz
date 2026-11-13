import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import pg from 'pg';
import path from 'node:path';
import { questions } from './questions.js';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3001);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined });

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
  `);
}

function publicQuestion(question) {
  return { id: question.id, question: question.question, options: question.options };
}

app.get('/api/quiz', (_req, res) => {
  const selected = [...questions].sort(() => Math.random() - 0.5).slice(0, 10).map(publicQuestion);
  res.json({ questions: selected, durationSeconds: 10, maxScorePerQuestion: 10 });
});

app.post('/api/check-answer', (req, res) => {
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

app.post('/api/submissions', async (req, res, next) => {
  try {
    const { name, city, phone, answers } = req.body ?? {};
    const cleanName = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
    const cleanCity = typeof city === 'string' ? city.trim().replace(/\s+/g, ' ') : '';
    const cleanPhone = typeof phone === 'string' ? phone.trim() : '';
    if (!cleanName || !cleanCity || !/^\d{10}$/.test(cleanPhone)) {
      return res.status(400).json({ message: 'Please provide a name, city, and a valid 10-digit phone number.' });
    }
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
        const elapsedMs = Math.max(0, Math.min(10000, Number(response.elapsedMs) || 10000));
        score += Math.max(1, Math.ceil(10 - elapsedMs / 1000));
      }
    }
    const windowStart = currentWindow();
    await pool.query(
      `INSERT INTO quiz_submissions (participant_name, city, phone, score, correct_count, window_start)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [cleanName.slice(0, 100), cleanCity.slice(0, 100), cleanPhone.slice(0, 25), score, correctCount, windowStart],
    );
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
