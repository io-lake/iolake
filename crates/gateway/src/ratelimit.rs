//! Per-bucket request rate limiting, a sibling of `admission`.
//!
//! `admission` sheds load when the gateway itself is strained (memory, in-flight
//! requests) and answers `503 SlowDown`. This layer caps the request *rate* of a
//! single bucket so one noisy bucket can't starve the others, and answers
//! `429 Too Many Requests`: the limit is the client's quota, not server overload.
//!
//! One token bucket per bucket name (`rate` req/s + `burst`), per gateway: a
//! cluster of N gateways enforces `rate × N`. The configured limit is read from
//! the same cache authorization uses, so a request costs no extra meta call.
//! A bucket with no limit set, or whose meta can't be read, is never limited.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use axum::extract::{Request, State};
use axum::http::{HeaderValue, Method, StatusCode, Uri, header};
use axum::middleware::Next;
use axum::response::Response;
use iolake_common::histogram::CounterVec;
use parking_lot::Mutex;
use std::sync::LazyLock;

use crate::s3::AppState;

static REJECTED: LazyLock<CounterVec> = LazyLock::new(CounterVec::new);

/// Requests refused by a per-bucket rate limit, for `/metrics`.
pub fn render(out: &mut String) {
    REJECTED.render(
        out,
        "iolake_gateway_rate_limited_total",
        "Requests refused with 429 by a per-bucket rate limit, by bucket",
    );
}

/// One bucket's token-bucket state.
struct Bucket {
    tokens: f64,
    last: Instant,
}

/// Per-bucket token buckets for this gateway.
// shortcut: entries are never evicted; add a TTL sweep if bucket churn grows unbounded.
#[derive(Clone, Default)]
pub struct Limiters(Arc<Mutex<HashMap<String, Bucket>>>);

impl Limiters {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Take one token for `key`; `None` = allowed, `Some(secs)` = refused with
    /// that long until the next token. `rate` must be > 0.
    fn take(&self, key: &str, rate: f64, burst: f64) -> Option<f64> {
        let now = Instant::now();
        let mut map = self.0.lock();
        let b = map.entry(key.to_string()).or_insert(Bucket {
            tokens: burst,
            last: now,
        });
        let elapsed = now.saturating_duration_since(b.last).as_secs_f64();
        b.last = now;
        b.tokens = (b.tokens + elapsed * rate).min(burst);
        if b.tokens >= 1.0 {
            b.tokens -= 1.0;
            None
        } else {
            Some((1.0 - b.tokens) / rate)
        }
    }
}

/// Layer state: the app (for the cached limit read) and this gateway's buckets.
pub struct RateLimitState {
    pub app: Arc<AppState>,
    limiters: Limiters,
}

impl RateLimitState {
    #[must_use]
    pub fn new(app: Arc<AppState>) -> Arc<Self> {
        Arc::new(Self {
            app,
            limiters: Limiters::new(),
        })
    }
}

/// The bucket a request addresses, or `None` for a request with no single bucket
/// (service-level routes, `ListAllMyBuckets`). The URI is already path-style here
/// (`addressing::rewrite` ran), so `classify` resolves both addressing styles.
fn bucket_of(method: &Method, uri: &Uri) -> Option<String> {
    match crate::authz::classify(method, uri.path(), uri.query().unwrap_or("")) {
        crate::authz::Authz::Check { bucket, .. } if !bucket.is_empty() => Some(bucket),
        _ => None,
    }
}

/// `429 Too Many Requests` with `Retry-After` and the limit that was hit.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)] // retry seconds: small, non-negative
fn too_many_requests(bucket: &str, rate: u64, retry_after: f64) -> Response {
    REJECTED.inc(&format!("bucket=\"{bucket}\""));
    let secs = retry_after.ceil().max(1.0) as u64;
    let mut resp = crate::s3::S3Error::xml_response(
        "TooManyRequests",
        "The bucket's request rate limit was exceeded.",
        StatusCode::TOO_MANY_REQUESTS,
    );
    let h = resp.headers_mut();
    if let Ok(v) = HeaderValue::from_str(&secs.to_string()) {
        h.insert(header::RETRY_AFTER, v);
    }
    if let Ok(v) = HeaderValue::from_str(&rate.to_string()) {
        h.insert("x-ratelimit-limit", v);
    }
    resp
}

/// Refuses a request over its bucket's configured rate with `429`. Runs after
/// authorization and before the body is read, so a refused request buffers none.
#[allow(clippy::cast_precision_loss)] // rate/burst are small request counts
pub async fn rate_limit_layer(
    State(state): State<Arc<RateLimitState>>,
    request: Request,
    next: Next,
) -> Response {
    let Some(bucket) = bucket_of(request.method(), request.uri()) else {
        return next.run(request).await;
    };
    let Some((rate, burst)) = crate::authz::bucket_rate_limit(&state.app, &bucket).await else {
        return next.run(request).await;
    };
    // burst 0 means "same as the rate"; never below one token.
    let burst = if burst == 0 { rate } else { burst }.max(1);
    match state.limiters.take(&bucket, rate as f64, burst as f64) {
        None => next.run(request).await,
        Some(retry_after) => too_many_requests(&bucket, rate, retry_after),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_full_bucket_allows_up_to_its_burst_then_refuses() {
        let l = Limiters::new();
        // burst of 3: three pass, the fourth is refused.
        assert!(l.take("b", 1.0, 3.0).is_none());
        assert!(l.take("b", 1.0, 3.0).is_none());
        assert!(l.take("b", 1.0, 3.0).is_none());
        assert!(l.take("b", 1.0, 3.0).is_some());
    }

    #[test]
    fn a_refusal_asks_to_wait_for_one_token() {
        let l = Limiters::new();
        assert!(l.take("b", 2.0, 1.0).is_none());
        // Empty now; at 2 req/s the next token is ~0.5s away.
        let retry = l.take("b", 2.0, 1.0).expect("refused");
        assert!((0.4..=0.6).contains(&retry), "retry was {retry}");
    }

    #[test]
    fn tokens_refill_over_time() {
        let l = Limiters::new();
        {
            let mut map = l.0.lock();
            map.insert(
                "b".to_string(),
                Bucket {
                    tokens: 0.0,
                    last: Instant::now() - std::time::Duration::from_secs(2),
                },
            );
        }
        // 2s at 5 req/s refilled well past one token (capped at burst 10).
        assert!(l.take("b", 5.0, 10.0).is_none());
    }

    #[test]
    fn buckets_are_isolated() {
        let l = Limiters::new();
        assert!(l.take("a", 1.0, 1.0).is_none());
        assert!(l.take("a", 1.0, 1.0).is_some());
        // A different bucket has its own full allowance.
        assert!(l.take("b", 1.0, 1.0).is_none());
    }

    #[test]
    fn a_refusal_is_429_with_retry_after() {
        let resp = too_many_requests("b", 100, 0.2);
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(resp.headers().get(header::RETRY_AFTER).unwrap(), "1");
        assert_eq!(resp.headers().get("x-ratelimit-limit").unwrap(), "100");
    }
}
