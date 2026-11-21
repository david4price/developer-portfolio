// P7-02: chat messages from VUS visitors at once, each in its own pre-seeded session (see
// docs/operations/load-testing.md). Only against a throwaway stack with a stand-in model: never
// production, which needs Turnstile and runs the shared GPU.
//   k6 run -e BASE_URL=http://127.0.0.1:23001 -e VUS=4 -e SESSIONS="$(cat sessions)" chat.js
// MESSAGES picks the input: `short` questions (default), `prose` (a 941-944-character English
// question, about 184 tokens: one classifier window), or `dense` (999 characters of rare letters,
// about 2,550 tokens: five full 512-token windows, the classifier's heaviest input).
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

// About 940 characters of an ordinary visitor question, varied by iteration.
const longQuestion = (iteration) =>
  `I'm comparing portfolio projects for a platform role (visit ${iteration}). ` +
  'Could you walk me through how the API, the worker, and the static site fit together, how ' +
  'deployments reach the home server through Argo CD, how the database is backed up and ' +
  'restored, what happens to the site when the server is offline, how the chat assistant ' +
  'keeps its answers grounded in the projects, how requests are limited so the model is not ' +
  'overloaded, which parts are tested automatically, and what you would change first if the ' +
  'site had a hundred times more visitors? I am especially interested in the trade-offs you ' +
  'made between running things yourself and using managed services, how secrets are kept out ' +
  'of the repository, and how you measured performance before choosing resource limits. ' +
  'Also, how does the explorer page read live cluster data without exposing anything private, ' +
  'and what would you watch first if the chat became popular and the model fell behind?';
// Letters the tokenizer has no merges for, so each takes two or three tokens.
const denseText = (() => {
  let text = '';
  while (text.length + 9 <= 999) text += 'ꙮꝎꞰꟿ⸎⺀㆐ꔀꕢ';
  return text;
})();
const MESSAGES = __ENV.MESSAGES ?? 'short';
const messageFor = (iteration) => {
  if (MESSAGES === 'prose') return longQuestion(iteration);
  if (MESSAGES === 'dense') return denseText;
  return questions[iteration % questions.length];
};

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
    JSON.stringify({ message: messageFor(__ITER) }),
    {
      headers: { 'content-type': 'application/json', cookie: `portfolio_chat=${session}` },
      tags: { name: 'chat message' },
      timeout: '60s',
    },
  );
  // Timeouts, resets, and proxy pages have no JSON body: they must still reach the check.
  let code = response.status === 200 ? 'ok' : String(response.status);
  if (response.status !== 200) {
    try {
      code = response.json('error.code') ?? code;
    } catch {
      // keep the status
    }
  }
  check(response, {
    // message_rejected is the screening's own verdict: handled, and the classifier still ran.
    'answered or turned away cleanly': () =>
      ['ok', 'ai_overloaded', 'chat_busy', 'message_rejected'].includes(code),
  });
}
