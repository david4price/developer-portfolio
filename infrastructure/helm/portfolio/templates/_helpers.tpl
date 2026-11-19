{{- define "portfolio.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "portfolio.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else if contains (include "portfolio.name" .) .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name (include "portfolio.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{/* Labels shared by every resource. */}}
{{- define "portfolio.labels" -}}
{{ include "portfolio.versionedLabels" (dict "root" . "version" .Chart.AppVersion) }}
{{- end }}

{{/* The shared labels with a given app.kubernetes.io/version. Usage: (dict "root" $ "version" "…") */}}
{{- define "portfolio.versionedLabels" -}}
helm.sh/chart: {{ printf "%s-%s" .root.Chart.Name .root.Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "portfolio.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/version: {{ .version | quote }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
app.kubernetes.io/part-of: portfolio
{{- end }}

{{/*
The version label for an image: its source commit (`image.revision`, written by the release
workflow) when set, otherwise the chart's appVersion. The Infrastructure Explorer shows the
short commit (P6-04).
*/}}
{{- define "portfolio.imageVersion" -}}
{{- $revision := .image.revision | default "" }}
{{- if $revision }}
{{- if not (kindIs "string" $revision) }}
{{- fail (printf "image %s: quote revision, or YAML reads an all-digit commit as a number" .image.repository) }}
{{- end }}
{{- if not (regexMatch "^[0-9a-f]{40}$" $revision) }}
{{- fail (printf "image %s: revision must be a full 40-character commit SHA" .image.repository) }}
{{- end }}
{{- $revision }}
{{- else }}
{{- .root.Chart.AppVersion }}
{{- end }}
{{- end }}

{{/* Selector labels for one component. Usage: include "portfolio.selectorLabels" (dict "root" $ "component" "api") */}}
{{- define "portfolio.selectorLabels" -}}
app.kubernetes.io/name: {{ include "portfolio.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/* Component labels; pass "version" for a workload built from this repository. */}}
{{- define "portfolio.componentLabels" -}}
{{ include "portfolio.versionedLabels" (dict "root" .root "version" (.version | default .root.Chart.AppVersion)) }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/* Image reference from {repository, digest, tag}; digest wins. */}}
{{- define "portfolio.image" -}}
{{- if .digest }}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" .digest) }}
{{- fail (printf "image %s: digest must look like sha256:<64 hex chars>" .repository) }}
{{- end }}
{{- printf "%s@%s" .repository .digest }}
{{- else if .tag }}
{{- printf "%s:%s" .repository .tag }}
{{- else }}
{{- fail (printf "image %s needs a digest or a tag" .repository) }}
{{- end }}
{{- end }}

{{/* Pod-level hardening. Usage: include "portfolio.podSecurityContext" 1000 */}}
{{- define "portfolio.podSecurityContext" -}}
runAsNonRoot: true
runAsUser: {{ . }}
runAsGroup: {{ . }}
fsGroup: {{ . }}
seccompProfile:
  type: RuntimeDefault
{{- end }}

{{- define "portfolio.containerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: [ALL]
{{- end }}

{{- define "portfolio.postgresHost" -}}
{{ include "portfolio.fullname" . }}-postgres
{{- end }}

{{- define "portfolio.redisUrl" -}}
redis://{{ include "portfolio.fullname" . }}-redis:6379
{{- end }}

{{/*
DATABASE_URL built from the referenced password Secret. Kubernetes expands $(DATABASE_PASSWORD) at
container start, so the password never appears in the rendered manifest or in `kubectl describe`.
*/}}
{{- define "portfolio.databaseEnv" -}}
- name: DATABASE_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ required "postgres.auth.existingSecret is required" .Values.postgres.auth.existingSecret }}
      key: {{ .Values.postgres.auth.passwordKey }}
- name: DATABASE_URL
  value: {{ printf "postgres://%s:$(DATABASE_PASSWORD)@%s:5432/%s" .Values.postgres.user (include "portfolio.postgresHost" .) .Values.postgres.database | quote }}
{{- end }}

{{/* UID of the `node` user in the official Node.js images (api, worker, migrations). */}}
{{- define "portfolio.nodeUid" -}}1000{{- end }}
