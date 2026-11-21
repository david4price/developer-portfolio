# Load Testing (P7-02)

_Run 2026-11-21 on the reference deployment (single K3s node, shared with other home-server
workloads) and on a throwaway local stack. Scripts: [`infrastructure/load-tests/`](../../infrastructure/load-tests/)._

**Result:** the API is far from its limits at any realistic traffic. In the cluster, 200 read
requests a second had p95 latency of 2.8 ms (under 6 ms at every rate) and no errors; the node
peaked at 6% CPU then, and at 9% during the local chat stage. The
measured numbers set the API's resources (below); `maxReplicas` stays at 3. One design gap
showed up under chat overload (see [Chat overload](#chat-overload-p7-08)).

## Method

Three stages, each with stop rules (node CPU over 60%, any other workload unhealthy, errors over
1%, p95 over 2 s) that never triggered. Usage came from `kubectl top` every 15 s, the API's own
[metrics](../deployment/kubernetes.md#api-metrics-p7-01), and `docker stats` for the local stack.

1. **Read path in the cluster.** A k6 pod in a temporary `loadtest` namespace, capped at 1 CPU,
   with a temporary NetworkPolicy letting only it reach the API port ([`cluster.yaml`](../../infrastructure/load-tests/cluster.yaml)).
   [`read-path.js`](../../infrastructure/load-tests/read-path.js) mixes the project list, a
   project page, the explorer snapshot, and readiness at a fixed rate, 60 s per step.
2. **Through Cloudflare.** The same script at 10 requests a second against the public API
   hostname from the home server, to see the tunnel and `cloudflared`.
3. **Chat, locally.** The released API image with chat and the classifier on, production's chat
   concurrency (1 AI call, 4 queued, 10 s wait), and a stand-in model that answers after 3 s
   ([`compose.chat.yaml`](../../infrastructure/load-tests/compose.chat.yaml),
   [`stub-ai.mjs`](../../infrastructure/load-tests/stub-ai.mjs)). Chat can't be load-tested in
   production: sessions need a real Turnstile solve, and the model runs on a shared GPU.
   Sessions are seeded into Redis with [`seed-sessions.sh`](../../infrastructure/load-tests/seed-sessions.sh)
   (Cloudflare's test secret returns no action, which the API rightly rejects).
   [`chat.js`](../../infrastructure/load-tests/chat.js) runs N visitors who send their next
   message as soon as the last one is answered; `LONG=1` sends 944-character messages, the
   classifier's heaviest input (two 512-token windows).

To rerun stage 3 (from the repository root; `<env>` sets `POSTGRES_*` and free ports, as in
`.env.example`):

```bash
export API_IMAGE=ghcr.io/<owner>/portfolio-api@sha256:<released digest>
export TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA   # Cloudflare's test secret
stack=(docker compose -p chat-load --env-file <env> -f compose.full.yaml \
  -f infrastructure/load-tests/compose.chat.yaml)
"${stack[@]}" up -d --no-build --wait api stub-ai
infrastructure/load-tests/seed-sessions.sh 8 "${stack[@]}" > sessions
k6 run -e BASE_URL=http://127.0.0.1:<API_PORT> -e VUS=4 -e LONG=1 -e SESSIONS="$(cat sessions)" \
  infrastructure/load-tests/chat.js
"${stack[@]}" down -v
```

To rerun stage 1:

```bash
kubectl apply -f infrastructure/load-tests/cluster.yaml          # the Pod waits for the ConfigMap
kubectl -n loadtest create configmap k6-scripts --from-file=infrastructure/load-tests/read-path.js
kubectl -n loadtest wait --for=condition=Ready pod/k6
kubectl -n loadtest exec k6 -- k6 run -e BASE_URL=http://portfolio-api.portfolio.svc:3001 \
  -e RATE=50 -e DURATION=60s /scripts/read-path.js
kubectl delete -f infrastructure/load-tests/cluster.yaml         # also stops a run at once
```

## Results

### Stage 1: read path in the cluster

| Rate (req/s) | Errors | p50    | p95    | p99    | API pods (HPA) |
| ------------ | ------ | ------ | ------ | ------ | -------------- |
| 10           | 0      | 3.3 ms | 5.3 ms | 6.3 ms | 1              |
| 25           | 0      | 3.1 ms | 4.5 ms | 5.1 ms | 1 → 2          |
| 50           | 0      | 2.8 ms | 4.1 ms | 4.5 ms | 2              |
| 100          | 0      | 2.3 ms | 3.4 ms | 4.0 ms | 2 → 3          |
| 200          | 0      | 2.0 ms | 2.8 ms | 3.4 ms | 3              |

No step failed, so the API's capacity is above 200 requests a second; the API's own metrics
recorded only `2xx`. CPU cost is about 1.75m per request a second (about 350m in all at 200/s).
With the old 100m request the HPA scaled out at 25 requests a second, well before any pressure.
The autoscaler returned to one pod about 8 minutes after the load stopped.

### Stage 2: through Cloudflare

600 of 600 requests succeeded at 10 a second; p95 182 ms, nearly all of it the round trip to the
edge. `cloudflared` peaked at 35m CPU and 27 MiB.

### Stage 3: chat (local, stand-in model)

| Visitors | Messages | Result                                                     | p95    | API CPU peak | Memory peak |
| -------- | -------- | ---------------------------------------------------------- | ------ | ------------ | ----------- |
| 1        | 20       | all answered                                               | 3.04 s | 6%           | 580 MiB     |
| 2        | 21       | all answered, queued behind one AI slot                    | 6.07 s | 4%           | 581 MiB     |
| 4        | 23       | all answered, queue waits up to ~9 s                       | 12.1 s | 5%           | 379 MiB     |
| 8        | 6,465    | 23 answered; the rest `ai_overloaded`, at once (p95 37 ms) | —      | 100% (1 CPU) | 422 MiB     |

The same with 944-character messages, under the new 1Gi limit:

| Visitors | Messages | Result                                                       | p95     | API CPU peak | Memory peak |
| -------- | -------- | ------------------------------------------------------------ | ------- | ------------ | ----------- |
| 1        | 20       | all answered                                                 | 3.10 s  | 10%          | 571 MiB     |
| 2        | 21       | all answered, queued behind one AI slot                      | 6.18 s  | 10%          | 454 MiB     |
| 4        | 23       | all answered, queue waits up to ~9 s                         | 12.36 s | 10%          | 392 MiB     |
| 8        | 588      | 21 answered; the rest `ai_overloaded` (p50 330 ms: screened) | —       | 100% (1 CPU) | 426 MiB     |

Throughput is set by the one AI slot, as designed: about one reply per model call. Overflow is
turned away without hanging (`ai_capacity_rejections_total`: 6,436 immediate and 6 after waiting
with short messages; 559 and 8 with long ones), and the container was never OOM-killed: under
1280Mi for the first run, under the new 1Gi limit for the long one.

### Peak use per component

| Component   | Peak CPU | Peak memory | Request before → after        | Limit before → after |
| ----------- | -------- | ----------- | ----------------------------- | -------------------- |
| API         | 195m     | 590 MiB     | 100m, 896Mi → **250m, 640Mi** | 1280Mi → **1Gi**     |
| PostgreSQL  | 76m      | 43 MiB      | 50m, 128Mi (kept)             | 512Mi (kept)         |
| Redis       | 43m      | 10 MiB      | 25m, 32Mi (kept)              | 128Mi (kept)         |
| cloudflared | 35m      | 27 MiB      | 20m, 32Mi (kept)              | 128Mi (kept)         |
| Worker      | 1m       | 45 MiB      | 25m, 96Mi (kept)              | 192Mi (kept)         |

## Decisions

- **API CPU request 250m** (was 100m): at the HPA's 70% target a pod now scales out at about
  175m. From the measured cost (about 15m idle plus 1.5–2.2m per read request a second) that is
  roughly 70–100 read requests a second per pod, instead of 25. Pods still scale before latency
  moves.
- **API memory 640Mi request, 1Gi limit** (was 896Mi / 1280Mi): measured peak 590 MiB with the
  classifier loaded, long messages included; the limit leaves about 1.7× that for GC and bursts.
- **`maxReplicas` stays 3:** three pods carried 200 requests a second with the node at 6%, and three
  640Mi requests fit easily beside the node's other workloads. More replicas add memory, not
  capacity anyone needs.
- **No CPU limits**, as before: the node has spare CPU, and throttling would only add latency.
- The other components stayed well inside their requests and limits, so they are unchanged.
- Not measured, so unchanged and still estimates: the `rules`-only API profile (`api.resources`,
  what forks run by default), the migration Job, and the backup CronJob.

## Chat Overload (P7-08)

With 8 visitors who retry at once, the API answered about 107 rejected messages a second and
used a full CPU doing it. Each message is screened (rules and the CPU classifier) before the AI
slot is checked (about 330 ms of CPU for a long message), and an immediate rejection is refunded
against the visitor's quotas, so a client
hammering an overloaded chat pays nothing for the screening it causes. Only Turnstile (needed per
session) and the one-message-at-a-time session lock bound it today. The rest of the API kept
answering, but a determined client could hold one pod's CPU. Tracked as **P7-08**.
