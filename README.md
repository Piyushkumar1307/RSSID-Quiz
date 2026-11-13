# Telmifast RSSDI Quiz

An interactive 10-question cardio-diabetes quiz with a 10-second timer per question, speed-weighted marks (1–10 points per correct answer), audio feedback, and a live all-time top-three leaderboard refreshed every five minutes.

## Run locally

1. Create `.env` from `.env.example` and put the Neon connection string in `DATABASE_URL`. Do not put it in `VITE_API_URL` or any client file.
2. Install packages with `npm install`.
3. Start the app with `npm run dev`.
4. Open the Vite URL shown in the terminal (normally `http://localhost:5173`).

The API starts at `http://localhost:3001` and creates `quiz_submissions` and its leaderboard index automatically.

## Deploy

Set `DATABASE_URL` and `PORT` in the host's encrypted environment variables. Then run:

```sh
npm run build
npm start
```

The Express service hosts the built app from `dist` and keeps the database credential off the client.

## Question bank

`server/questions.js` contains the 100 supplied questions and answer key. It is intentionally server-only. To regenerate it after replacing the document:

```sh
npm run import:questions -- /absolute/path/to/RSSDI_100_Cardio_Diabetes_MCQ_Questions.docx
```
