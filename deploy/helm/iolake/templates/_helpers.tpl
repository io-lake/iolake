{{/*
Expand the name of the chart.
*/}}
{{- define "iolake.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "iolake.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "iolake.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "iolake.selectorLabels" . }}
app.kubernetes.io/version: {{ .Values.global.imageTag | default .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "iolake.selectorLabels" -}}
app.kubernetes.io/name: {{ include "iolake.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Gateway fullname.
*/}}
{{- define "iolake.gateway.fullname" -}}
{{- printf "%s-gateway" (include "iolake.fullname" .) }}
{{- end }}

{{/*
Meta fullname.
*/}}
{{- define "iolake.meta.fullname" -}}
{{- printf "%s-meta" (include "iolake.fullname" .) }}
{{- end }}

{{/*
Meta headless service name.
*/}}
{{- define "iolake.meta.headless" -}}
{{- printf "%s-meta-headless" (include "iolake.fullname" .) }}
{{- end }}

{{/*
OSD fullname.
*/}}
{{- define "iolake.osd.fullname" -}}
{{- printf "%s-osd" (include "iolake.fullname" .) }}
{{- end }}

{{/*
OSD headless service name.
*/}}
{{- define "iolake.osd.headless" -}}
{{- printf "%s-osd-headless" (include "iolake.fullname" .) }}
{{- end }}

{{/*
Block Gateway fullname.
*/}}
{{- define "iolake.blockGateway.fullname" -}}
{{- printf "%s-block-gateway" (include "iolake.fullname" .) }}
{{- end }}

{{/*
Resolve image for a component.
If global.image is set, use it (unified all-in-one image).
Otherwise, use the per-component image from global.imageRegistry/component.image.
Usage: include "iolake.image" (dict "global" .Values.global "component" .Values.gateway)
*/}}
{{- define "iolake.image" -}}
{{- if .global.image -}}
{{- printf "%s/%s:%s" .global.imageRegistry .global.image.repository (.global.image.tag | default "latest") }}
{{- else -}}
{{- printf "%s/%s:%s" .global.imageRegistry .component.image.repository (.component.image.tag | default "latest") }}
{{- end -}}
{{- end }}

{{/*
Prometheus fullname.
*/}}
{{- define "iolake.prometheus.fullname" -}}
{{- printf "%s-prometheus" (include "iolake.fullname" .) }}
{{- end }}

{{/*
Grafana fullname.
*/}}
{{- define "iolake.grafana.fullname" -}}
{{- printf "%s-grafana" (include "iolake.fullname" .) }}
{{- end }}

{{/*
mTLS between the services (A8a): the Secret holding a role's certificate
(tls.crt, tls.key, ca.crt, as cert-manager writes them), and what each
component mounts and sets from it. Each certificate names its role in a
SAN URI, spiffe://objectio/<role>: meta, osd, gateway, block-gateway or
admin. Usage: include "iolake.tls.secretName" (dict "ctx" . "role" "meta")
*/}}
{{- define "iolake.tls.secretName" -}}
{{- (index .ctx.Values.tls.secrets .role) | default (printf "%s-tls-%s" (include "iolake.fullname" .ctx) .role) -}}
{{- end }}

{{/*
The roles there are, each with the names its certificate must carry
(the addresses peers dial it by).
*/}}
{{- define "iolake.tls.roles" -}}
{{- $roles := dict "meta" (list (include "iolake.meta.fullname" .) (include "iolake.meta.headless" .)) "osd" (list (include "iolake.osd.fullname" .) (include "iolake.osd.headless" .)) "gateway" (list (include "iolake.gateway.fullname" .)) "admin" (list) }}
{{- if .Values.blockGateway.enabled }}
{{- $_ := set $roles "block-gateway" (list (include "iolake.blockGateway.fullname" .)) }}
{{- end }}
{{- toJson $roles }}
{{- end }}

{{- define "iolake.tls.env" -}}
{{- if .Values.tls.enabled }}
- name: IOLAKE_TLS_CERT
  value: /etc/objectio-tls/tls.crt
- name: IOLAKE_TLS_KEY
  value: /etc/objectio-tls/tls.key
- name: IOLAKE_TLS_CA
  value: /etc/objectio-tls/ca.crt
{{- end }}
{{- end }}

{{- define "iolake.tls.volumeMount" -}}
{{- if .Values.tls.enabled }}
- name: tls
  mountPath: /etc/objectio-tls
  readOnly: true
{{- end }}
{{- end }}

{{- /* Usage: include "iolake.tls.volume" (dict "ctx" . "role" "osd") */ -}}
{{- define "iolake.tls.volume" -}}
{{- if .ctx.Values.tls.enabled }}
- name: tls
  secret:
    secretName: {{ include "iolake.tls.secretName" . }}
{{- end }}
{{- end }}

{{/*
The tools image (sh + curl): the Raft bootstrap Job, the OSDs' node-label
lookup.
*/}}
{{- define "iolake.toolsImage" -}}
{{- printf "%s:%s" .Values.global.toolsImage.repository (.Values.global.toolsImage.tag | toString) -}}
{{- end }}

{{/*
Pod-spec fields every component takes from its values: image pull
secrets, priority class, nodeSelector, affinity, tolerations and
topologySpreadConstraints. A spread constraint without a labelSelector
gets the component's pods' labels.
Usage: include "iolake.podPlacement" (dict "root" . "values" .Values.osd "component" "osd")
*/}}
{{- define "iolake.podPlacement" -}}
{{- with .root.Values.global.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .values.priorityClassName }}
priorityClassName: {{ . | quote }}
{{- end }}
{{- with .values.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .values.affinity }}
affinity:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .values.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- if .values.topologySpreadConstraints }}
{{- $labels := merge (dict "app.kubernetes.io/component" .component) (fromYaml (include "iolake.selectorLabels" .root)) }}
topologySpreadConstraints:
{{- range .values.topologySpreadConstraints }}
  - {{- toYaml (merge (deepCopy .) (dict "labelSelector" (dict "matchLabels" $labels))) | nindent 4 }}
{{- end }}
{{- end }}
{{- end }}

{{/*
The probes a component's values give (startupProbe, livenessProbe,
readinessProbe), at the container's indentation. An httpGet probe of a
port in httpsPorts (by name or number) asks over HTTPS unless it names
its scheme: meta's admin port is HTTPS under mTLS. Kubelet presents no
client certificate and doesn't verify the server's, and the probes'
paths (/health, /ready) take a client without one.
Usage: include "iolake.probes" (dict "values" .Values.meta "httpsPorts" (list "admin"))
*/}}
{{- define "iolake.probes" -}}
{{- $https := .httpsPorts | default list }}
{{- range $name := list "startupProbe" "livenessProbe" "readinessProbe" }}
{{- with index $.values $name }}
{{- $probe := deepCopy . }}
{{- if $probe.httpGet }}
{{- if and (has (toString $probe.httpGet.port) $https) (not $probe.httpGet.scheme) }}
{{- $_ := set $probe.httpGet "scheme" "HTTPS" }}
{{- end }}
{{- end }}
{{ $name }}:
  {{- toYaml $probe | nindent 2 }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Refuse values that would lose data or can't work. Rendered once, from
validate.yaml.
*/}}
{{- define "iolake.validate" -}}
{{- $k := int .Values.ec.k }}
{{- $m := int .Values.ec.m }}
{{- if lt $k 1 }}
{{- fail (printf "ec.k is %d: a stripe needs at least one data shard" $k) }}
{{- end }}
{{- $copies := int .Values.replication }}
{{- if lt $copies 0 }}
{{- fail (printf "replication is %d: 0 (erasure coding) or a number of copies" $copies) }}
{{- end }}
{{- if and (eq $copies 0) (lt $m 1) }}
{{- fail "ec.m is 0: an erasure-coded pool needs parity (one unprotected copy is replication: 1)" }}
{{- end }}
{{- if and (eq $copies 0) (lt (int .Values.osd.replicas) (add $k $m)) }}
{{- fail (printf "osd.replicas is %d, fewer than ec.k + ec.m = %d: each shard of a stripe goes to a different OSD. Add OSDs or choose a smaller code." (int .Values.osd.replicas) (add $k $m)) }}
{{- end }}
{{- if lt (int .Values.osd.replicas) $copies }}
{{- fail (printf "osd.replicas is %d, fewer than replication = %d: each copy goes to a different OSD" (int .Values.osd.replicas) $copies) }}
{{- end }}
{{- if and .Values.blockGateway.enabled (lt (int .Values.osd.replicas) (add $k $m)) }}
{{- fail (printf "the block gateway codes volumes ec.k + ec.m = %d, more than osd.replicas = %d" (add $k $m) (int .Values.osd.replicas)) }}
{{- end }}
{{- if lt (int .Values.meta.replicas) 1 }}
{{- fail "meta.replicas must be at least 1 (3 or 5 for a cluster that survives a node)" }}
{{- end }}
{{- if not (has .Values.osd.persistence.data.volumeMode (list "Filesystem" "Block")) }}
{{- fail (printf "osd.persistence.data.volumeMode is %q: Filesystem or Block" .Values.osd.persistence.data.volumeMode) }}
{{- end }}
{{- range $level, $label := .Values.osd.failureDomain.nodeLabels }}
{{- if not (has $level (list "region" "zone" "datacenter" "rack")) }}
{{- fail (printf "osd.failureDomain.nodeLabels.%s: the levels read from node labels are region, zone, datacenter and rack (host is the node itself)" $level) }}
{{- end }}
{{- if not $label }}
{{- fail (printf "osd.failureDomain.nodeLabels.%s names no label" $level) }}
{{- end }}
{{- end }}
{{- if and .Values.gateway.sse.existingSecret .Values.gateway.sse.masterKey }}
{{- fail "gateway.sse: set existingSecret or masterKey, not both" }}
{{- end }}
{{- /*
A release installed by the chart before the rename to IOLake (0.1.0-rc.3,
chart "objectio") named its resources after that chart. Upgraded under
this one's name, it would get new StatefulSets, new volumes and a new SSE
master key beside the old ones: an empty cluster. Only for the upgrade
from 0.1.0-rc.3; `lookup` sees nothing under `helm template`.
*/ -}}
{{- if not (or .Values.nameOverride .Values.fullnameOverride) }}
{{- $old := ternary .Release.Name (printf "%s-objectio" .Release.Name) (contains "objectio" .Release.Name) | trunc 63 | trimSuffix "-" }}
{{- if and (ne $old (include "iolake.fullname" .)) (lookup "apps/v1" "StatefulSet" .Release.Namespace (printf "%s-meta" $old)) }}
{{- fail (printf "release %s was installed by the objectio chart (0.1.0-rc.3): upgrade it with --set nameOverride=objectio, which keeps its resources' names (%s-*), its volumes and its SSE key" .Release.Name $old) }}
{{- end }}
{{- end }}
{{- end }}
