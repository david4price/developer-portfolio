// A stand-in for the OpenAI-compatible model runtime (P7-02 chat load test): answers every
// completion after DELAY_MS with a fixed reply, so the API's own cost per message can be measured
// without a GPU. Never deployed.
import { createServer } from 'node:http';

const delayMs = Number(process.env.DELAY_MS ?? 3000);
const reply = 'It is a static Next.js site with a NestJS API, deployed with Argo CD on K3s.';

createServer((request, response) => {
  const send = (status, body) =>
    response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  if (request.method === 'GET' && request.url?.endsWith('/models')) {
    return send(200, { data: [{ id: 'stub' }] });
  }
  if (request.method === 'POST' && request.url?.endsWith('/chat/completions')) {
    request.resume();
    return request.on('end', () =>
      setTimeout(
        () =>
          send(200, {
            choices: [{ message: { content: reply } }],
            usage: { completion_tokens: 20 },
          }),
        delayMs,
      ),
    );
  }
  send(404, { error: 'not found' });
}).listen(8000, '0.0.0.0');
