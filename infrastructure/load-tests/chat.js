// P7-02: chat messages from VUS visitors at once, each in its own pre-seeded session (see
// docs/operations/load-testing.md). Only against a throwaway stack with a stand-in model: never
// production, which needs Turnstile and runs the shared GPU.
//   k6 run -e BASE_URL=http://127.0.0.1:23001 -e VUS=4 -e SESSIONS=a,b,c,d chat.js
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL;
const VUS = Number(__ENV.VUS ?? 1);
const sessions = (__ENV.SESSIONS ?? '').split(',').filter(Boolean);
if (sessions.length < VUS) throw new Error(`need ${VUS} session ids, got ${sessions.length}`);

const questions = [
  'What does the developer portfolio project do?',
  'How is the API deployed?',
  'Which databases does the site use?',
  'What is the Infrastructure Explorer?',
];

export const options = {
  scenarios: {
    visitors: { executor: 'constant-vus', vus: VUS, duration: __ENV.DURATION ?? '60s' },
  },
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const session = sessions[(__VU - 1) % sessions.length];
  const response = http.post(
    `${BASE_URL}/api/v1/chat/messages`,
    JSON.stringify({ message: questions[__ITER % questions.length] }),
    {
      headers: { 'content-type': 'application/json', cookie: `portfolio_chat=${session}` },
      tags: { name: 'chat message' },
      timeout: '60s',
    },
  );
  const code =
    response.status === 200 ? 'ok' : (response.json('error.code') ?? String(response.status));
  check(response, {
    'answered or turned away cleanly': () => ['ok', 'ai_overloaded', 'chat_busy'].includes(code),
  });
}
