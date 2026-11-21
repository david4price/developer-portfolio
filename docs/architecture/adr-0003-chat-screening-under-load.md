# ADR 0003: Chat Screening Fails Closed; a Full Queue Is Refused First

- **Status:** Accepted (2026-11-21), P7-08. Supersedes the "rules' verdict stands" fallback from
  P5-08 ([AI integration](ai-integration.md#message-screening-confirmed-p5-07)).
- **Owner's choice:** fail closed, a flat 5 s classifier budget, one change.

## Context

The P7-02 load tests ([load testing](../operations/load-testing.md#chat-overload-p7-08)) found
two gaps in the chat's order of work (lock, quotas, screening, AI slot):

- **Overload was free and costly.** With the AI queue full, every message was still counted,
  fully screened, turned away, and refunded. Eight visitors resending at once held a whole CPU
  screening messages that could never be answered, and never ran out of quota.
- **The classifier could be switched off at will.** Without a score (timeout, full queue, error)
  the rules' verdict stood alone. A 999-character message of rare letters is about 2,550 tokens:
  seven overlapping 512-token windows and about 1.5–2 s of one CPU, at the 2 s timeout. Padding
  an injection that way, or flooding the classifier's queue, skipped it.

The P5-08 reason for failing open was availability: refusing every message whenever the
classifier lags would let a burst take the chat down. But the chat answers about one message per
model call (3 s or more), while the classifier scores an ordinary message in about 10 ms. It only
lags under a flood or crafted input, and then refusing costs little.

## Decision

1. **Capacity first.** Before the quotas and screening, the chat asks the AI limiter
   `hasCapacity()`: a read-only Redis script with the same rules as acquiring a slot or a queue
   place. A full queue answers `503 ai_overloaded` with `Retry-After` at once: no quota is
   charged and nothing is screened. It's advisory; acquiring the slot stays authoritative.
2. **A budget that fits.** `CHAT_GUARD_TIMEOUT_MS` defaults to 5 s (was 2 s), about 2.5× the
   heaviest message on the reference CPU. Ordinary messages are unaffected.
3. **Fail closed.** A message without a score is refused as `503 ai_overloaded` (retryable),
   never passed on the rules alone. The quota is refunded when the classifier did no work (its
   queue was full, or it failed) and charged after a timeout, which spent real CPU. Errors are
   logged at error level: a broken model now stops the chat instead of weakening it.

## Consequences

- Measured on the stage-3 stack: a rejected message costs about 0.5 ms of CPU (was 10 ms for a
  short message and about 100 ms for prose), and dense messages never reached the model unscored,
  alone (all scored) or eight at once (refused when the classifier fell behind).
- A client that resends without pause still keeps a CPU busy, as it would on any endpoint
  (`/health` under the same flood: 13,400 requests a second at 129% CPU). That limit belongs at
  the edge, before the tunnel, not in the API.
- Chat availability now depends on the classifier: a model that fails at runtime refuses every
  message until it's fixed (a model that doesn't load already stopped the API at startup).
- Rejected alternatives: holding the AI slot while screening (wastes model time on messages that
  then fail screening); stopping refunds past an allowance (still screens doomed messages and
  penalizes real visitors during real overload); failing open with alerts (keeps the bypass).
