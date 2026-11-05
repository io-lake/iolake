//! A bucket's S3 settings on the admin API, for the console:
//! `/_admin/buckets/{name}/{versioning,object-lock,encryption,lifecycle,replication}`.
//!
//! The S3 path (`/{bucket}?versioning` and the rest) takes a SigV4
//! signature, and the console holds a session cookie, so it could neither
//! read these settings nor change them. These routes run the S3 handlers'
//! own code (`*_doc` / `*_document`: the same checks, the same meta calls,
//! the same caches dropped) behind the gate every per-bucket admin route
//! has, [`crate::admin::require_bucket_tenant_admin`]: the system admin, or
//! an admin of the bucket's tenant.
//!
//! Each configuration is S3's document as JSON, element for element, with
//! the names S3 gives them in XML; a repeated element (`Rule`, `Tag`) is an
//! array under its own name. `GET` answers the document; `PUT` takes one
//! and answers `204`; `DELETE` (where S3 has one) answers `204`.
//!
//! An error is `{"code", "message"}` with S3's status and code. A setting
//! the bucket doesn't have is `404` with S3's code for it
//! (`ObjectLockConfigurationNotFoundError`,
//! `ServerSideEncryptionConfigurationNotFoundError`,
//! `NoSuchLifecycleConfiguration`, `ReplicationConfigurationNotFoundError`);
//! a bucket that isn't there is `404` `NoSuchBucket`. Versioning is a state,
//! never missing: a bucket never versioned is `{}`, as S3 answers it.

use std::sync::Arc;

use axum::{
    Extension, Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use bytes::Bytes;
use iolake_auth::AuthResult;
use serde::{Serialize, de::DeserializeOwned};

use crate::s3::AppState;

/// An error as these routes give it.
fn error(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        Json(serde_json::json!({ "code": code, "message": message })),
    )
        .into_response()
}

/// The code for an error that came without one (the admin gate's plain
/// text). Every route here is on a bucket, so a 404 is the bucket's.
fn code_for(status: StatusCode) -> &'static str {
    match status {
        StatusCode::BAD_REQUEST => "InvalidRequest",
        StatusCode::UNAUTHORIZED => "AuthenticationRequired",
        StatusCode::FORBIDDEN => "AccessDenied",
        StatusCode::NOT_FOUND => "NoSuchBucket",
        StatusCode::CONFLICT => "Conflict",
        StatusCode::SERVICE_UNAVAILABLE => "ServiceUnavailable",
        _ => "InternalError",
    }
}

#[derive(serde::Deserialize)]
struct ErrorXml {
    #[serde(rename = "Code")]
    code: String,
    #[serde(rename = "Message", default)]
    message: String,
}

/// An S3 error answer (`<Error><Code>…`), or the gate's plain-text one, as
/// JSON with the same status.
async fn json_error(resp: Response) -> Response {
    let status = resp.status();
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024)
        .await
        .unwrap_or_default();
    let text = String::from_utf8_lossy(&body);
    match quick_xml::de::from_str::<ErrorXml>(&text) {
        Ok(e) => error(status, &e.code, &e.message),
        Err(_) => error(status, code_for(status), text.trim()),
    }
}

/// The gate, its refusal as JSON.
async fn gate(
    state: &AppState,
    auth: &Option<Extension<AuthResult>>,
    headers: &HeaderMap,
    bucket: &str,
) -> Option<Response> {
    match crate::admin::require_bucket_tenant_admin(state, auth, headers, bucket).await {
        Some(deny) => Some(json_error(deny).await),
        None => None,
    }
}

/// A `GET`'s answer: the document, or the error.
async fn read<T: Serialize>(doc: Result<T, Response>) -> Response {
    match doc {
        Ok(doc) => Json(doc).into_response(),
        Err(resp) => json_error(resp).await,
    }
}

/// A `PUT`'s or `DELETE`'s answer: `204`, or the error.
async fn written(resp: Response) -> Response {
    if resp.status().is_success() {
        StatusCode::NO_CONTENT.into_response()
    } else {
        json_error(resp).await
    }
}

/// A `PUT`'s body: the document, or `400 MalformedJSON`.
#[allow(clippy::result_large_err)]
fn document<T: DeserializeOwned>(body: &[u8]) -> Result<T, Response> {
    serde_json::from_slice(body).map_err(|e| {
        error(
            StatusCode::BAD_REQUEST,
            "MalformedJSON",
            &format!("The configuration is not valid JSON for this setting: {e}"),
        )
    })
}

// ── Versioning (no DELETE in S3) ────────────────────────────────────────

pub async fn get_versioning(
    State(state): State<Arc<AppState>>,
    auth: Option<Extension<AuthResult>>,
    headers: HeaderMap,
    Path(bucket): Path<String>,
) -> Response {
    if let Some(deny) = gate(&state, &auth, &headers, &bucket).await {
        return deny;
    }
    read(crate::s3::get_bucket_versioning_doc(&state, &bucket).await).await
}

pub async fn put_versioning(
    State(state): State<Arc<AppState>>,
    auth: Option<Extension<AuthResult>>,
    headers: HeaderMap,
    Path(bucket): Path<String>,
    body: Bytes,
) -> Response {
    if let Some(deny) = gate(&state, &auth, &headers, &bucket).await {
        return deny;
    }
    match document(&body) {
        Ok(doc) => written(crate::s3::put_bucket_versioning_doc(&state, &bucket, &doc).await).await,
        Err(resp) => resp,
    }
}

// ── Object Lock (no DELETE in S3: once on, it stays on) ─────────────────

pub async fn get_object_lock(
    State(state): State<Arc<AppState>>,
    auth: Option<Extension<AuthResult>>,
    headers: HeaderMap,
    Path(bucket): Path<String>,
) -> Response {
    if let Some(deny) = gate(&state, &auth, &headers, &bucket).await {
        return deny;
    }
    read(crate::s3::get_object_lock_config_doc(&state, &bucket).await).await
}

pub async fn put_object_lock(
    State(state): State<Arc<AppState>>,
    auth: Option<Extension<AuthResult>>,
    headers: HeaderMap,
    Path(bucket): Path<String>,
    body: Bytes,
) -> Response {
    if let Some(deny) = gate(&state, &auth, &headers, &bucket).await {
        return deny;
    }
    match document(&body) {
        Ok(doc) => written(crate::s3::put_object_lock_config_doc(&state, &bucket, doc).await).await,
        Err(resp) => resp,
    }
}

// ── Default encryption ──────────────────────────────────────────────────

pub async fn get_encryption(
    State(state): State<Arc<AppState>>,
    auth: Option<Extension<AuthResult>>,
    headers: HeaderMap,
    Path(bucket): Path<String>,
) -> Response {
    if let Some(deny) = gate(&state, &auth, &headers, &bucket).await {
        return deny;
    }
    read(crate::s3::get_bucket_encryption_doc(&state, &bucket).await).await
}

pub async fn put_encryption(
    State(state): State<Arc<AppState>>,
    auth: Option<Extension<AuthResult>>,
    headers: HeaderMap,
    Path(bucket): Path<String>,
    body: Bytes,
) -> Response {
    if let Some(deny) = gate(&state, &auth, &headers, &bucket).await {
        return deny;
    }
    match document(&body) {
        Ok(doc) => written(crate::s3::put_bucket_encryption_doc(&state, &bucket, &doc).await).await,
        Err(resp) => resp,
    }
}

pub async fn delete_encryption(
    State(state): State<Arc<AppState>>,
    auth: Option<Extension<AuthResult>>,
    headers: HeaderMap,
    Path(bucket): Path<String>,
) -> Response {
    if let Some(deny) = gate(&state, &auth, &headers, &bucket).await {
        return deny;
    }
    written(crate::s3::delete_bucket_encryption_internal(state, bucket).await).await
}

// ── Lifecycle ───────────────────────────────────────────────────────────

pub async fn get_lifecycle(
    State(state): State<Arc<AppState>>,
    auth: Option<Extension<AuthResult>>,
    headers: HeaderMap,
    Path(bucket): Path<String>,
) -> Response {
    if let Some(deny) = gate(&state, &auth, &headers, &bucket).await {
        return deny;
    }
    read(crate::lifecycle::get_document(&state, &bucket).await).await
}

pub async fn put_lifecycle(
    State(state): State<Arc<AppState>>,
    auth: Option<Extension<AuthResult>>,
    headers: HeaderMap,
    Path(bucket): Path<String>,
    body: Bytes,
) -> Response {
    if let Some(deny) = gate(&state, &auth, &headers, &bucket).await {
        return deny;
    }
    match document(&body) {
        Ok(doc) => written(crate::lifecycle::put_document(&state, &bucket, doc).await).await,
        Err(resp) => resp,
    }
}

pub async fn delete_lifecycle(
    State(state): State<Arc<AppState>>,
    auth: Option<Extension<AuthResult>>,
    headers: HeaderMap,
    Path(bucket): Path<String>,
) -> Response {
    if let Some(deny) = gate(&state, &auth, &headers, &bucket).await {
        return deny;
    }
    written(crate::lifecycle::delete_config(&state, &bucket).await).await
}

// ── Replication ─────────────────────────────────────────────────────────

pub async fn get_replication(
    State(state): State<Arc<AppState>>,
    auth: Option<Extension<AuthResult>>,
    headers: HeaderMap,
    Path(bucket): Path<String>,
) -> Response {
    if let Some(deny) = gate(&state, &auth, &headers, &bucket).await {
        return deny;
    }
    read(crate::replication::get_document(&state, &bucket).await).await
}

pub async fn put_replication(
    State(state): State<Arc<AppState>>,
    auth: Option<Extension<AuthResult>>,
    headers: HeaderMap,
    Path(bucket): Path<String>,
    body: Bytes,
) -> Response {
    if let Some(deny) = gate(&state, &auth, &headers, &bucket).await {
        return deny;
    }
    match document(&body) {
        Ok(doc) => written(crate::replication::put_document(&state, &bucket, doc).await).await,
        Err(resp) => resp,
    }
}

pub async fn delete_replication(
    State(state): State<Arc<AppState>>,
    auth: Option<Extension<AuthResult>>,
    headers: HeaderMap,
    Path(bucket): Path<String>,
) -> Response {
    if let Some(deny) = gate(&state, &auth, &headers, &bucket).await {
        return deny;
    }
    written(crate::replication::delete_config(&state, &bucket).await).await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn body_json(resp: Response) -> serde_json::Value {
        let bytes = axum::body::to_bytes(resp.into_body(), 1 << 20)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    /// An S3 error keeps its status and code; the gate's plain text gets
    /// the code of its status.
    #[tokio::test]
    async fn errors_are_json_with_s3s_status_and_code() {
        let s3 = crate::s3::S3Error::xml_response(
            "NoSuchLifecycleConfiguration",
            "The lifecycle configuration does not exist",
            StatusCode::NOT_FOUND,
        );
        let resp = json_error(s3).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            body_json(resp).await,
            serde_json::json!({
                "code": "NoSuchLifecycleConfiguration",
                "message": "The lifecycle configuration does not exist",
            })
        );

        for (status, code) in [
            (StatusCode::NOT_FOUND, "NoSuchBucket"),
            (StatusCode::FORBIDDEN, "AccessDenied"),
            (StatusCode::UNAUTHORIZED, "AuthenticationRequired"),
        ] {
            let resp = json_error((status, "Not a tenant admin").into_response()).await;
            assert_eq!(resp.status(), status);
            let v = body_json(resp).await;
            assert_eq!(v["code"], code);
            assert_eq!(v["message"], "Not a tenant admin");
        }
    }

    /// A body that isn't the setting's document is refused before anything
    /// is called.
    #[test]
    fn a_body_that_is_not_the_document_is_malformed_json() {
        let resp = document::<crate::s3::VersioningConfiguration>(b"<Status/>").unwrap_err();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let ok: crate::s3::VersioningConfiguration = document(br#"{"Status":"Enabled"}"#).unwrap();
        assert_eq!(ok.status.as_deref(), Some("Enabled"));
    }

    /// Each document reads from JSON what S3 reads from XML, and writes the
    /// same names back.
    #[test]
    fn the_json_documents_use_s3s_element_names() {
        let lock: crate::s3::ObjectLockConfiguration = document(
            br#"{"ObjectLockEnabled":"Enabled","Rule":{"DefaultRetention":{"Mode":"GOVERNANCE","Days":30}}}"#,
        )
        .unwrap();
        let xml: crate::s3::ObjectLockConfiguration = quick_xml::de::from_str(
            "<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled>\
             <Rule><DefaultRetention><Mode>GOVERNANCE</Mode><Days>30</Days></DefaultRetention></Rule>\
             </ObjectLockConfiguration>",
        )
        .unwrap();
        assert_eq!(lock, xml);
        assert_eq!(
            serde_json::to_value(&lock).unwrap(),
            serde_json::json!({
                "ObjectLockEnabled": "Enabled",
                "Rule": {"DefaultRetention": {"Mode": "GOVERNANCE", "Days": 30}},
            })
        );

        let sse: crate::s3::SseConfiguration = document(
            br#"{"Rule":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}"#,
        )
        .unwrap();
        assert_eq!(sse.rules.len(), 1);
        assert_eq!(
            serde_json::to_value(&sse).unwrap(),
            serde_json::json!({
                "Rule": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}],
            })
        );

        let never: crate::s3::VersioningConfiguration = Default::default();
        assert_eq!(serde_json::to_value(&never).unwrap(), serde_json::json!({}));
    }
}
