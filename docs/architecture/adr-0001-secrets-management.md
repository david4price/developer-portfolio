# ADR 0001: Secrets Management with Sealed Secrets

- **Status:** Accepted (2026-11-12). Implemented 2026-11-13 (P3-08): controller chart 2.22.0 /
  0.41.2, key renewal off, certificate committed, key backed up locally (P1-04), and restore
  drilled. Procedures are in the [deployment guide](../deployment/kubernetes.md#3-secrets).
- **Task:** P3-07

## Context

The Helm chart renders no Secrets; it references existing ones by name
(`postgres.auth.existingSecret`). Today those Secrets are created by hand with `kubectl`, so a
rebuilt cluster can't be restored from Git alone. The reference deployment needs a handful of
secrets: the PostgreSQL password, Cloudflare Tunnel credentials (Phase 4), the Turnstile secret
key (Phase 5), and an Argo CD read-only token (Phase 6).

Constraints:

- The repository is **public**. Whatever is committed must be safe to publish forever.
- Argo CD syncs the cluster from Git and should stay a stock installation where possible.
- One operator and one node: fewer moving parts beats flexibility.
- Contributors must still be able to run everything without the owner's keys (Project Rule 5).

Options considered:

| Option                         | For                                                                              | Against                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Manual `kubectl create secret` | Nothing to install                                                               | Not reproducible from Git; easy to forget on a rebuild                                                              |
| **Sealed Secrets**             | Argo CD applies `SealedSecret` resources natively; private key stays in-cluster  | Extra controller; secrets can't be read back from Git; the controller key must be backed up                         |
| SOPS + age                     | Edit secrets locally in plaintext; key names visible in diffs; works outside K8s | Argo CD needs a plugin (helm-secrets or KSOPS), the `sops` binary, and the private key mounted into the repo server |
| External Secrets Operator      | Rotation and auditing through a secret store                                     | Needs a secret backend (Vault, cloud KMS, …) that this project doesn't have                                         |

## Decision

Use **Sealed Secrets** for every Secret the reference deployment needs.

- **Controller:** the upstream Sealed Secrets Helm chart in `kube-system`, chart version and image
  digest pinned like every other image. Installing it is a 🔒 step (P3-08).
- **Automatic key renewal off** (`keyrenewperiod: "0"`). With the default 30-day renewal, every new
  key must be backed up again. Renewal doesn't re-encrypt existing secrets either, so it adds
  little for one operator. Rotate by hand instead (see below).
- **Scope:** the default `strict` scope, so each `SealedSecret` only decrypts for its own name and
  namespace.
- **Location:** `infrastructure/environments/production/secrets/<name>.sealedsecret.yaml`, synced by
  the Argo CD Application (P3-04) with `argocd.argoproj.io/sync-wave: "-1"`, so Secrets exist
  before PostgreSQL (wave 0) and the migrate Job (wave 1). Argo CD ships a health check for
  `SealedSecret`, so the wave waits until the controller has unsealed it.
- **Sealing offline:** the controller's **public** certificate is committed at
  `infrastructure/environments/production/sealed-secrets.pem`. Sealing then needs no cluster
  access:

  ```bash
  kubectl create secret generic portfolio-postgres -n portfolio \
    --from-literal=password='<password>' --dry-run=client -o yaml \
    | kubeseal --cert infrastructure/environments/production/sealed-secrets.pem -o yaml \
    > infrastructure/environments/production/secrets/portfolio-postgres.sealedsecret.yaml
  ```

  Never commit the intermediate plaintext Secret, and never pass it through a file in the repo.

- **Key backup:** right after installing the controller, export its key pair once and store it
  encrypted at the off-host backup destination (P1-04). Never put it in the repository or the
  homelab repo:

  ```bash
  kubectl -n kube-system get secret -l sealedsecrets.bitnami.com/sealed-secrets-key -o yaml
  ```

- **The chart doesn't change:** it keeps referencing Secrets by name, so it stays unaware of
  how they're created.

## Consequences

- Argo CD stays stock. One more small controller runs on the node.
- A rebuilt cluster is restored by applying the backed-up key **before** the controller starts
  (or before the first sync); otherwise every `SealedSecret` must be re-sealed from the original
  values.
- Secrets can't be read back from Git. Changing one means re-sealing it from the source value, kept
  in the owner's password manager.
- **Ciphertext is public forever.** If the controller key leaks, every committed secret, including
  ones in old commits, must be treated as exposed and **rotated** (new values, re-sealed), not just
  deleted.
- **Manual rotation:** to replace the key, trigger an early key renewal (set the controller's
  `--key-cutoff-time` to the current time and restart it). Then commit the new certificate,
  re-seal every secret, back up the new key, and remove the old key once nothing uses it.
- **Contributors and forks** can't decrypt the owner's secrets and don't need to. They create the
  same named Secrets with `kubectl`, or run their own controller and commit their own sealed files.
- Gitleaks may flag `encryptedData` as high-entropy. If it does, allowlist
  `infrastructure/environments/*/secrets/*.sealedsecret.yaml` in `.gitleaks.toml`, and nothing
  else.
