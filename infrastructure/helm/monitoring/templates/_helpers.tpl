{{- define "monitoring.labels" -}}
app.kubernetes.io/name: monitoring
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: monitoring
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end }}

{{/* monitoring.peer <labels>: a podSelector peer in this namespace. */}}
{{- define "monitoring.peer" -}}
- podSelector:
    matchLabels:
      {{- toYaml . | nindent 6 }}
{{- end }}

{{/* monitoring.apiServer <root>: the egress rule to the Kubernetes API server. */}}
{{- define "monitoring.apiServer" -}}
{{- with .Values.networkPolicy.apiServerEgress }}
{{- if or (not .cidr) (not .port) }}
{{- fail "networkPolicy.apiServerEgress.cidr and .port are required" }}
{{- end }}
- to:
    - ipBlock:
        cidr: {{ .cidr }}
  ports:
    - protocol: TCP
      port: {{ .port }}
{{- end }}
{{- end }}
