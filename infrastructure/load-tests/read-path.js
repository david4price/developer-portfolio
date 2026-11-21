// P7-02: the API's public read path at one fixed request rate.
//   k6 run -e BASE_URL=http://portfolio-api.portfolio.svc:3001 -e RATE=50 -e DURATION=60s read-path.js
// The mix approximates a visitor: project list, a project page, the explorer's snapshot (cached
// for 12 s), and readiness. No chat: that needs Turnstile and the model (see chat.js).
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL;
const RATE = Number(__ENV.RATE ?? 10);
const SLUG = __ENV.SLUG ?? 'developer-portfolio';

const paths = [
  ['/api/v1/projects', 4],
  [`/api/v1/projects/${SLUG}`, 3],
  ['/api/v1/infrastructure', 2],
  ['/api/v1/health/ready', 1],
];
const weighted = paths.flatMap(([path, weight]) => Array(weight).fill(path));

export const options = {
  scenarios: {
    fixed_rate: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: __ENV.DURATION ?? '60s',
      preAllocatedVUs: Math.max(10, RATE),
      maxVUs: Math.max(50, RATE * 4),
    },
  },
  // Safety stop: abort the run, not just mark it failed, if the API clearly struggles.
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '10s' }],
    http_req_duration: [{ threshold: 'p(95)<2000', abortOnFail: true, delayAbortEval: '10s' }],
  },
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const path = weighted[Math.floor(Math.random() * weighted.length)];
  const response = http.get(`${BASE_URL}${path}`, { tags: { name: path.replace(SLUG, ':slug') } });
  check(response, { 'status is 200': (r) => r.status === 200 });
}
