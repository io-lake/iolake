//! Audit export and search: read the system audit bucket's hourly NDJSON over a time range, filter by api/tenant/text, and return NDJSON or CSV, scoped to the caller's tenant.

use std::collections::HashMap;
use std::sync::Arc;

use axum::Json;
use axum::body::Body;
use axum::extract::{Extension, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Timelike, Utc};
use iolake_auth::AuthResult;
use serde_json::{Value, json};

use crate::s3::AppState;

/// The most of one NDJSON object read into memory at once (a batch of events).
const MAX_OBJECT_BYTES: usize = 64 * 1024 * 1024;
/// Keys listed per hour prefix in one page.
const LIST_PAGE: u32 = 1000;
/// The search view's default cap when `limit` is not given.
const DEFAULT_LIMIT: usize = 1000;

/// `GET /_admin/audit/events`: with `limit`, a JSON array of the newest matches (console search); without it, a streamed NDJSON/CSV download.
pub async fn admin_audit_events(
    State(state): State<Arc<AppState>>,
    auth: Option<Extension<AuthResult>>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    // Gate resolves the scope: a tenant admin is forced to its own tenant; a system admin may pass ?tenant= to filter, else sees all.
    let admin = match crate::iam_admin::admin_in(
        &state,
        &auth,
        &headers,
        params.get("tenant").map(String::as_str),
    )
    .await
    {
        Ok(a) => a,
        Err(r) => return r,
    };

    let Some(bucket) = state.audit_system_bucket.clone() else {
        return error(
            StatusCode::CONFLICT,
            "audit export requires the gateway's --audit-system-bucket",
        );
    };

    let (Some(from), Some(to)) = (parse_time(params.get("from")), parse_time(params.get("to")))
    else {
        return error(
            StatusCode::BAD_REQUEST,
            "from and to are required ISO-8601 timestamps (e.g. 2026-11-08T00:00:00Z)",
        );
    };
    if from > to {
        return error(StatusCode::BAD_REQUEST, "from must not be after to");
    }

    let filter = Filter {
        scope: admin.tenant,
        api: params.get("api").cloned().filter(|s| !s.is_empty()),
        q: params
            .get("q")
            .map(|s| s.to_lowercase())
            .filter(|s| !s.is_empty()),
        from,
        to,
    };
    let limit = params.get("limit").and_then(|l| l.parse::<usize>().ok());
    let csv = params.get("format").is_some_and(|f| f == "csv");

    if let Some(limit) = limit.or(params.contains_key("limit").then_some(DEFAULT_LIMIT)) {
        search(&state, &bucket, &filter, limit, csv).await
    } else {
        stream_export(Arc::clone(&state), bucket, filter, csv)
    }
}

/// Console search: scan newest hour first, collect up to `limit` matches newest-first (bounded, so safe to buffer).
async fn search(
    state: &Arc<AppState>,
    bucket: &str,
    filter: &Filter,
    limit: usize,
    csv: bool,
) -> Response {
    let mut hits: Vec<Value> = Vec::new();
    'hours: for hour in hour_prefixes(filter.from, filter.to).into_iter().rev() {
        let mut keys = list_hour(state, bucket, &hour).await;
        keys.reverse();
        for key in keys {
            let Some(body) = read_object(state, bucket, &key).await else {
                continue;
            };
            for raw in body.split(|b| *b == b'\n').rev() {
                if let Some(v) = filter.keep(raw) {
                    hits.push(v);
                    if hits.len() >= limit {
                        break 'hours;
                    }
                }
            }
        }
    }
    hits.sort_by(|a, b| b["time"].as_str().cmp(&a["time"].as_str()));
    if csv {
        let mut out = String::from(CSV_HEADER);
        for v in &hits {
            out.push_str(&csv_row(v));
        }
        text_response("text/csv", out)
    } else {
        Json(hits).into_response()
    }
}

/// Download: stream every match across the range, object by object, so memory is bounded by one object not the whole range.
fn stream_export(state: Arc<AppState>, bucket: String, filter: Filter, csv: bool) -> Response {
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Vec<u8>, std::io::Error>>(8);
    tokio::spawn(async move {
        if csv {
            let _ = tx.send(Ok(CSV_HEADER.as_bytes().to_vec())).await;
        }
        for hour in hour_prefixes(filter.from, filter.to) {
            for key in list_hour(&state, &bucket, &hour).await {
                let Some(body) = read_object(&state, &bucket, &key).await else {
                    continue;
                };
                let mut chunk = Vec::new();
                for raw in body.split(|b| *b == b'\n') {
                    if let Some(v) = filter.keep(raw) {
                        if csv {
                            chunk.extend_from_slice(csv_row(&v).as_bytes());
                        } else {
                            chunk.extend_from_slice(raw);
                            chunk.push(b'\n');
                        }
                    }
                }
                if !chunk.is_empty() && tx.send(Ok(chunk)).await.is_err() {
                    return; // client hung up
                }
            }
        }
    });
    let ct = if csv {
        "text/csv"
    } else {
        "application/x-ndjson"
    };
    (
        [
            (header::CONTENT_TYPE, ct),
            (
                header::CONTENT_DISPOSITION,
                if csv {
                    "attachment; filename=\"audit.csv\""
                } else {
                    "attachment; filename=\"audit.ndjson\""
                },
            ),
        ],
        Body::from_stream(tokio_stream::wrappers::ReceiverStream::new(rx)),
    )
        .into_response()
}

/// What an exported event must match; an empty scope is the system admin (every tenant), else a line is kept only if it belongs to that tenant by either tenant field.
struct Filter {
    scope: String,
    api: Option<String>,
    q: Option<String>,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
}

impl Filter {
    /// The parsed event if the raw line passes every filter, else `None`.
    fn keep(&self, raw: &[u8]) -> Option<Value> {
        if raw.is_empty() {
            return None;
        }
        if let Some(q) = &self.q
            && !String::from_utf8_lossy(raw).to_lowercase().contains(q)
        {
            return None;
        }
        let v: Value = serde_json::from_slice(raw).ok()?;
        if !self.scope.is_empty() {
            let bt = v["bucket_tenant"].as_str().unwrap_or_default();
            let pt = v["principal"]["tenant"].as_str().unwrap_or_default();
            if bt != self.scope && pt != self.scope {
                return None;
            }
        }
        if let Some(api) = &self.api
            && v["api"].as_str() != Some(api.as_str())
        {
            return None;
        }
        let t = parse_rfc3339(v["time"].as_str()?)?;
        if t < self.from || t > self.to {
            return None;
        }
        Some(v)
    }
}

/// The hour-prefix keys (`2026-11-08T13`) covering `[from, to]`, inclusive.
fn hour_prefixes(from: DateTime<Utc>, to: DateTime<Utc>) -> Vec<String> {
    let mut out = Vec::new();
    let mut h = from
        .with_minute(0)
        .and_then(|t| t.with_second(0))
        .and_then(|t| t.with_nanosecond(0))
        .unwrap_or(from);
    while h <= to {
        out.push(h.format("%Y/%m/%d/%H").to_string());
        h += chrono::Duration::hours(1);
    }
    out
}

/// Every object key under one hour prefix, paging through truncation.
async fn list_hour(state: &Arc<AppState>, bucket: &str, hour: &str) -> Vec<String> {
    let prefix = format!("{hour}/");
    let mut client = state.meta_client.clone();
    let mut keys = Vec::new();
    let mut token: Option<String> = None;
    loop {
        let r = state
            .scatter_gather
            .list_objects(
                &mut client,
                bucket,
                &prefix,
                LIST_PAGE,
                token.as_deref(),
                "",
            )
            .await;
        let Ok(page) = r else { break };
        keys.extend(page.objects.into_iter().map(|o| o.key));
        if page.is_truncated {
            token = page.next_continuation_token;
            if token.is_none() {
                break;
            }
        } else {
            break;
        }
    }
    keys
}

/// Read one system-bucket object through the normal object path; `None` on any non-200 or oversize body.
async fn read_object(state: &Arc<AppState>, bucket: &str, key: &str) -> Option<Vec<u8>> {
    let resp = crate::s3::get_object(
        State(Arc::clone(state)),
        axum::extract::Path((bucket.to_string(), key.to_string())),
        None,
        HeaderMap::new(),
    )
    .await;
    if resp.status() != StatusCode::OK {
        return None;
    }
    axum::body::to_bytes(resp.into_body(), MAX_OBJECT_BYTES)
        .await
        .ok()
        .map(|b| b.to_vec())
}

const CSV_HEADER: &str = "time,api,method,status,action,bucket,key,bucket_tenant,principal_tenant,principal_user_id,principal_auth,source_ip,error_code,request_bytes,response_bytes,duration_ms,complete,id\n";

/// One CSV row for an event, columns matching [`CSV_HEADER`].
fn csv_row(v: &Value) -> String {
    let s = |p: &Value| p.as_str().unwrap_or_default().to_string();
    let n = |p: &Value| p.as_u64().map(|x| x.to_string()).unwrap_or_default();
    let cols = [
        s(&v["time"]),
        s(&v["api"]),
        s(&v["method"]),
        n(&v["status"]),
        s(&v["action"]),
        s(&v["bucket"]),
        s(&v["key"]),
        s(&v["bucket_tenant"]),
        s(&v["principal"]["tenant"]),
        s(&v["principal"]["user_id"]),
        s(&v["principal"]["auth"]),
        s(&v["source"]["ip"]),
        s(&v["error_code"]),
        n(&v["request_bytes"]),
        n(&v["response_bytes"]),
        n(&v["duration_ms"]),
        v["complete"]
            .as_bool()
            .map(|b| b.to_string())
            .unwrap_or_default(),
        s(&v["id"]),
    ];
    let mut row = cols
        .iter()
        .map(|c| csv_escape(c))
        .collect::<Vec<_>>()
        .join(",");
    row.push('\n');
    row
}

/// A CSV field, quoted when it holds a comma, quote or newline.
fn csv_escape(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// Parse an ISO-8601 / RFC-3339 timestamp (query parameter).
fn parse_time(s: Option<&String>) -> Option<DateTime<Utc>> {
    parse_rfc3339(s?.as_str())
}

fn parse_rfc3339(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|t| t.with_timezone(&Utc))
}

fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

fn text_response(content_type: &'static str, body: String) -> Response {
    ([(header::CONTENT_TYPE, content_type)], body).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dt(s: &str) -> DateTime<Utc> {
        parse_rfc3339(s).unwrap()
    }

    #[test]
    fn hour_prefixes_cover_the_range_inclusive_across_a_day_boundary() {
        let got = hour_prefixes(dt("2026-11-08T22:30:00Z"), dt("2026-11-09T01:05:00Z"));
        assert_eq!(
            got,
            vec![
                "2026/11/08/22",
                "2026/11/08/23",
                "2026/11/09/00",
                "2026/11/09/01",
            ]
        );
    }

    #[test]
    fn a_single_hour_range_is_one_prefix() {
        let got = hour_prefixes(dt("2026-11-08T12:00:00Z"), dt("2026-11-08T12:59:59Z"));
        assert_eq!(got, vec!["2026/11/08/12"]);
    }

    fn event(tenant_bucket: &str, principal_tenant: &str, api: &str, time: &str) -> Vec<u8> {
        json!({
            "time": time, "api": api, "action": "s3:GetObject", "bucket": "b",
            "bucket_tenant": tenant_bucket,
            "principal": { "tenant": principal_tenant, "user_id": "u1" },
        })
        .to_string()
        .into_bytes()
    }

    fn base_filter(scope: &str) -> Filter {
        Filter {
            scope: scope.to_string(),
            api: None,
            q: None,
            from: dt("2026-11-08T00:00:00Z"),
            to: dt("2026-11-08T23:59:59Z"),
        }
    }

    #[test]
    fn tenant_scope_keeps_only_the_tenants_events() {
        let f = base_filter("acme");
        // bucket belongs to acme
        assert!(
            f.keep(&event("acme", "", "s3", "2026-11-08T12:00:00Z"))
                .is_some()
        );
        // principal is an acme user acting on a system bucket
        assert!(
            f.keep(&event("", "acme", "s3", "2026-11-08T12:00:00Z"))
                .is_some()
        );
        // another tenant entirely
        assert!(
            f.keep(&event("globex", "globex", "s3", "2026-11-08T12:00:00Z"))
                .is_none()
        );
    }

    #[test]
    fn empty_scope_is_the_system_admin_and_keeps_every_tenant() {
        let f = base_filter("");
        assert!(
            f.keep(&event("globex", "globex", "s3", "2026-11-08T12:00:00Z"))
                .is_some()
        );
    }

    #[test]
    fn api_and_time_and_text_filters_narrow() {
        let mut f = base_filter("");
        f.api = Some("iceberg".to_string());
        assert!(
            f.keep(&event("", "", "s3", "2026-11-08T12:00:00Z"))
                .is_none()
        );
        assert!(
            f.keep(&event("", "", "iceberg", "2026-11-08T12:00:00Z"))
                .is_some()
        );

        let mut f = base_filter("");
        f.to = dt("2026-11-08T13:00:00Z");
        assert!(
            f.keep(&event("", "", "s3", "2026-11-08T14:00:00Z"))
                .is_none()
        );

        let mut f = base_filter("");
        f.q = Some("getobject".to_string());
        assert!(
            f.keep(&event("", "", "s3", "2026-11-08T12:00:00Z"))
                .is_some()
        );
        f.q = Some("deletebucket".to_string());
        assert!(
            f.keep(&event("", "", "s3", "2026-11-08T12:00:00Z"))
                .is_none()
        );
    }

    #[test]
    fn csv_escapes_commas_and_quotes() {
        assert_eq!(csv_escape("plain"), "plain");
        assert_eq!(csv_escape("a,b"), "\"a,b\"");
        assert_eq!(csv_escape("a\"b"), "\"a\"\"b\"");
    }
}
