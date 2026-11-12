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
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "portfolio.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: portfolio
{{- end }}

{{/* Selector labels for one component. Usage: include "portfolio.selectorLabels" (dict "root" $ "component" "api") */}}
{{- define "portfolio.selectorLabels" -}}
app.kubernetes.io/name: {{ include "portfolio.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "portfolio.componentLabels" -}}
{{ include "portfolio.labels" .root }}
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
