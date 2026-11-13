# Runbooks

Procedures marked **Proposed** apply once the corresponding phase is deployed.

## Health Triage

1. `GET /api/v1/health`. A failure means the process is down or wedged; look at pod or container
   status and logs.
2. `GET /api/v1/health/ready`. The `checks` object names the failing dependency.
3. Search the structured logs by `requestId`. Every response returns it in the `x-request-id`
   header and in error bodies.

## Rollback

**Application image (Proposed):** revert the commit that changed the image digest in
`infrastructure/environments/production/values.yaml`. Argo CD rolls back to the previous digest.

**Migration compatibility rules** (these keep image rollback safe):

- Migrations must be backward compatible with the previous release. Add columns as nullable or with
  defaults, and never rename or drop columns in the same release that stops using them.
- Destructive changes take two releases: release N stops using the column, release N+1 drops it.
- Never roll back the database by hand. If a migration itself is broken, write a new forward
  migration.

## Backups (P3-05)

- **What:** the CronJob `portfolio-postgres-backup` runs `pg_dump --format=custom` every night
  at 03:17 UTC. Each dump is written to a temporary name, checked with `pg_restore --list`, then
  renamed, so a half-written dump is never kept.
- **Where:** a host directory outside the cluster's data directory (production:
  `/srv/portfolio-backups/postgres`), so `k3s-uninstall.sh` can't remove it. It must exist,
  owned by uid/gid 70 (the postgres image user) with mode `0700`:
  `sudo install -d -o 70 -g 70 -m 700 /srv/portfolio-backups/postgres`. The CronJob refuses to
  run if the directory is missing (`hostPath` type `Directory`).
- **Retention:** 7 daily dumps (`daily/`) and 4 weekly copies taken on Sundays (`weekly/`).
- **Locked down:** the Job runs as uid 70, non-root, with a read-only root filesystem and no
  capabilities. Its NetworkPolicy allows only PostgreSQL, and PostgreSQL admits it explicitly.
- **Local only** (P1-04): the backups share the host's disk. Copy them off the machine before
  treating the site as production.
- **Waits for PostgreSQL:** a new pod's connections are refused for about two seconds until
  K3s's network policy controller admits its IP, so the script polls `pg_isready` for up to a
  minute before dumping.
- **Run one now:** `kubectl -n portfolio create job --from=cronjob/portfolio-postgres-backup backup-manual-$(date +%s)`

### Restore Drill

Monthly, and after any schema or backup change. It never touches the live database:

1. Start a scratch PostgreSQL 17 with the backup directory mounted read-only.
2. `pg_restore --clean --if-exists --no-owner` the newest dump into it.
3. Run the API image's migrations against the scratch database; they must apply nothing.
4. Compare row counts per table with production.
5. Record the result here.

Storage capacity alone doesn't prove recoverability. Only a successful restore counts.

| Date       | Dump                  | Result                                                                                                                  |
| ---------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 2026-11-13 | first backup (4.8 KB) | Passed: production PostgreSQL image on an isolated network; restore clean; migrations applied nothing; row counts match |

## Home Server Offline

- Expected: the static site stays up, and API-backed widgets show "unavailable". Verified by the
  offline drill below.
- Publicly, `api.<domain>` answers `502` while pods stop, then Cloudflare's `530` (tunnel has no
  connector). Those error pages carry no CORS headers, so browsers log a CORS error for the health
  check; the badge treats it as "unavailable", which is correct.
- Nothing to fail over; the deployment is single-node by design. After the host returns:
  1. Confirm `kubectl get pods -n portfolio` is all Ready.
  2. Confirm the tunnel is connected (`cf tunnels get <id>`: `healthy`).
  3. Confirm readiness returns 200 and Argo CD is `Synced/Healthy`.

### Offline Drill (P4-04)

Repeat after changes to the site's API handling, the tunnel, or K3s. Needs `sudo` and a few
minutes of API downtime.

1. Record the baseline: Docker containers and health, portfolio pods, a PostgreSQL row count, and
   site/API status codes.
2. Watch from outside: poll `https://<domain>/` and `https://api.<domain>/api/v1/health` every few
   seconds, and load the site in a browser once the API is down.
3. Stop the whole cluster: `sudo /usr/local/bin/k3s-killall.sh`. (`systemctl stop k3s` is not
   enough: K3s leaves pods running.) The `kube-port-guard` unit isn't a `k3s*` unit, so it stays up.
4. After a few minutes: `sudo systemctl start k3s`.
5. Check: the site returned 200 throughout and its badge read "API unavailable — the site still
   works"; afterwards pods are Ready, the tunnel is healthy, Argo CD is synced, the row count is
   unchanged, and the Docker services are unchanged.

Last run, 2026-11-13: about 3 min 16 s of API downtime (`502`, then `530`). The site served 200
throughout; the badge read "API unavailable — the site still works", then "API online" again.
Pods restarted once each and came back Ready, the tunnel reconnected with 4 connections, Argo CD
returned to `Synced/Healthy`, the PostgreSQL data was intact, and the 14 Docker containers were
unaffected.

## Inference Overload (Proposed, Phase 5)

- Symptoms: chat returns `ai_overloaded` or `ai_unavailable`, and rejected-request metrics rise.
- The AI path is isolated, so the rest of the API keeps working.
- Actions:
  - Confirm the inference runtime is up.
  - Check whether other workloads share it.
  - Lower per-IP quotas, or set `AI_ENABLED=false` and redeploy to switch chat off entirely.

## GPU Driver Mismatch on the Host

Symptom: the host's `nvidia-smi` reports "Driver/library version mismatch" after a driver package
upgrade, while containers that started before the upgrade keep working.

1. Confirm inference still works from inside the runtime container.
2. Schedule a reboot so the new kernel module loads, and announce the downtime.
3. After the reboot, check that `nvidia-smi` works on the host, then make one test request against
   the model.
4. Rollback: boot the previous kernel/driver from the boot menu.

## Secrets Rotation

1. Create the new value in the secret store.
2. Update the Kubernetes Secret.
3. `kubectl rollout restart deployment/<name> -n portfolio`.
4. Revoke the old value.
5. If a secret ever reaches Git, rotate it first, then clean up history. History rewriting alone is
   not enough.
