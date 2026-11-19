# Telmifast RSSDI Quiz

An interactive 10-question cardio-diabetes quiz with a 20-second timer per question, speed-weighted marks (1–10 points per correct answer), audio feedback, and a live all-time top-three leaderboard refreshed every five minutes.

## Run locally

1. Create `.env` from `.env.example` and put the Neon connection string in `DATABASE_URL`. Do not put it in `VITE_API_URL` or any client file.
2. Install packages with `npm install`.
3. Start the app with `npm run dev`.
4. Open the Vite URL shown in the terminal (normally `http://localhost:5173`).

The API starts at `http://localhost:3001` and creates its submission, OTP, and 10-hour login-session tables automatically.

## OTP login with Twilio

The participant form sends and verifies an SMS OTP before a quiz can start. The account SID and auth token stay on the server; never add them to a `VITE_` variable or commit `.env`.

For the recommended Twilio Verify integration, configure these encrypted variables locally and on Render:

```sh
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_VERIFY_SERVICE_SID=VA...
```

Twilio Verify requires a Verify Service SID in addition to the Account SID and Auth Token. A Twilio trial account can only SMS phone numbers that have been verified in Twilio. If instead using Programmable Messaging, configure either `TWILIO_PHONE_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`.

For the requested organizer fallback, `OTP_FALLBACK_CODE=2345` is accepted only after an OTP request for that same phone number. Set `OTP_ALLOW_FALLBACK=false` to turn this shared bypass off for production.

## Deploy

Set `DATABASE_URL`, `PORT`, and the Twilio variables above in the host's encrypted environment variables. Then run:

```sh
npm run build
npm start
```

The Express service hosts the built app from `dist` and keeps the database credential off the client.

## Scheduled wheel winner

Open `/winner` to temporarily force the spin wheel to show a supplied winner name. The organizer can select 1, 2, or 3 hours, or delete the schedule to return the wheel to random participant selection immediately.

Set a strong server-only `WINNER_ADMIN_KEY` environment variable locally and on the deployed host before opening this page. The page asks for that key and stores it only for the current browser session.

## Question bank

`server/questions.js` contains the 100 supplied questions and answer key. It is intentionally server-only. To regenerate it after replacing the document:

```sh
npm run import:questions -- /absolute/path/to/RSSDI_100_Cardio_Diabetes_MCQ_Questions.docx
```
