//! A bucket's S3 settings on the admin API, as the console reaches them.
//!
//! The console signs in with a session cookie and calls `/_admin/*`; a
//! bucket's versioning, object lock, default encryption, lifecycle and
//! replication were only on the S3 path (`/{bucket}?versioning`, …), whose
//! `SigV4` layer refuses a session. The console showed them as off when it
//! simply could not read them, and could not turn versioning on at all.
//! `/_admin/buckets/{name}/{versioning,object-lock,encryption,lifecycle,
//! replication}` serve them, gated as every per-bucket admin route is.

use objectio_e2e::{Cluster, Response, http_client};
use serde_json::{Value, json};

/// Console sign-in with a key: the session cookie's value.
fn key_login(c: &Cluster, ak: &str, sk: &str) -> String {
    let r = http_client()
        .post(format!("{}/_console/api/login", c.endpoint))
        .header("Content-Type", "application/json")
        .body(json!({"accessKey": ak, "secretKey": sk}).to_string())
        .send()
        .unwrap();
    assert_eq!(r.status().as_u16(), 200, "login");
    r.headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find_map(|c| c.split(';').next()?.strip_prefix("objectio-session="))
        .expect("a session")
        .to_string()
}

/// A request as the console makes it: the session cookie, a JSON body.
fn console(c: &Cluster, session: &str, method: &str, path: &str, body: Option<Value>) -> Response {
    let mut req = http_client()
        .request(method.parse().unwrap(), format!("{}{path}", c.endpoint))
        .header("Cookie", format!("objectio-session={session}"));
    if let Some(body) = body {
        req = req
            .header("Content-Type", "application/json")
            .body(body.to_string());
    }
    Response::from(req.send().expect("request"))
}

/// The error code of a JSON error answer.
#[track_caller]
fn code(r: &Response) -> String {
    r.json()["code"]
        .as_str()
        .unwrap_or_else(|| panic!("no code in {}", r.text()))
        .to_string()
}

/// A tenant with an admin: the admin's `(access_key, secret_key)`.
fn tenant_admin(c: &Cluster, tenant: &str) -> (String, String) {
    c.json(
        "POST",
        "/_admin/tenants",
        json!({"name": tenant, "display_name": tenant, "enabled": true}),
    )
    .expect_ok();
    let user = c.json(
        "POST",
        "/_admin/users",
        json!({"display_name": format!("{tenant}-admin"), "tenant": tenant}),
    );
    user.expect_ok();
    let user_id = user.json()["user_id"].as_str().unwrap().to_string();
    c.json(
        "POST",
        &format!("/_admin/tenants/{tenant}/admins"),
        json!({"user_id": user_id}),
    )
    .expect_ok();
    let key = c.json(
        "POST",
        &format!("/_admin/users/{user_id}/access-keys"),
        json!({}),
    );
    key.expect_ok();
    let k = key.json();
    (
        k["access_key_id"].as_str().unwrap().to_string(),
        k["secret_access_key"].as_str().unwrap().to_string(),
    )
}

/// The system admin's console session reads and changes each setting; what
/// it writes is what the S3 path reads, and a setting the bucket doesn't
/// have is a 404 with S3's code for it.
#[test]
#[allow(clippy::too_many_lines)] // one console session, setting by setting
fn the_console_reads_and_changes_a_buckets_settings() {
    let c = Cluster::start();
    let session = key_login(&c, &c.access_key, &c.secret_key);
    c.json("POST", "/_admin/buckets", json!({"name": "photos"}))
        .expect_ok();
    let at = |setting: &str| format!("/_admin/buckets/photos/{setting}");

    // The S3 path refuses the session: why these routes exist.
    let s3 = http_client()
        .get(format!("{}/photos?versioning", c.endpoint))
        .header("Cookie", format!("objectio-session={session}"))
        .send()
        .unwrap();
    assert_eq!(s3.status().as_u16(), 403);

    // Versioning: never set is `{}`; on, it reads back and S3 sees it.
    let r = console(&c, &session, "GET", &at("versioning"), None);
    r.expect(200);
    assert_eq!(r.json(), json!({}));
    console(
        &c,
        &session,
        "PUT",
        &at("versioning"),
        Some(json!({"Status": "Enabled"})),
    )
    .expect(204);
    let r = console(&c, &session, "GET", &at("versioning"), None);
    r.expect(200);
    assert_eq!(r.json(), json!({"Status": "Enabled"}));
    assert!(
        c.request("GET", "/photos?versioning", &[])
            .text()
            .contains("<Status>Enabled</Status>")
    );
    let r = console(
        &c,
        &session,
        "PUT",
        &at("versioning"),
        Some(json!({"Status": "Sometimes"})),
    );
    r.expect(400);
    assert_eq!(code(&r), "MalformedXML");
    let r = console(&c, &session, "PUT", &at("versioning"), None);
    r.expect(400);
    assert_eq!(code(&r), "MalformedJSON");

    // Not configured: 404, with S3's code for each.
    for (setting, want) in [
        ("lifecycle", "NoSuchLifecycleConfiguration"),
        (
            "encryption",
            "ServerSideEncryptionConfigurationNotFoundError",
        ),
        ("object-lock", "ObjectLockConfigurationNotFoundError"),
        ("replication", "ReplicationConfigurationNotFoundError"),
    ] {
        let r = console(&c, &session, "GET", &at(setting), None);
        r.expect(404);
        assert_eq!(code(&r), want, "{setting}");
    }

    // Lifecycle: put, read back as written, seen by S3, refused when S3
    // would refuse it, deleted.
    let lifecycle = json!({"Rule": [{
        "ID": "expire-logs",
        "Filter": {"Prefix": "logs/"},
        "Status": "Enabled",
        "Expiration": {"Days": 30},
    }]});
    console(
        &c,
        &session,
        "PUT",
        &at("lifecycle"),
        Some(lifecycle.clone()),
    )
    .expect(204);
    let r = console(&c, &session, "GET", &at("lifecycle"), None);
    r.expect(200);
    assert_eq!(r.json(), lifecycle);
    let s3 = c.request("GET", "/photos?lifecycle", &[]);
    s3.expect(200);
    assert!(s3.text().contains("<Days>30</Days>"), "{}", s3.text());
    let r = console(
        &c,
        &session,
        "PUT",
        &at("lifecycle"),
        Some(json!({"Rule": [{"ID": "x", "Filter": {}, "Status": "Enabled"}]})),
    );
    r.expect(400);
    assert_eq!(code(&r), "InvalidRequest", "{}", r.text());
    console(&c, &session, "DELETE", &at("lifecycle"), None).expect(204);
    console(&c, &session, "GET", &at("lifecycle"), None).expect(404);

    // Default encryption: put, read back, deleted.
    let sse = json!({"Rule": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]});
    console(&c, &session, "PUT", &at("encryption"), Some(sse.clone())).expect(204);
    let r = console(&c, &session, "GET", &at("encryption"), None);
    r.expect(200);
    assert_eq!(r.json(), sse);
    console(&c, &session, "DELETE", &at("encryption"), None).expect(204);
    console(&c, &session, "GET", &at("encryption"), None).expect(404);

    // Replication runs S3's checks: a target that doesn't exist is refused.
    let r = console(
        &c,
        &session,
        "PUT",
        &at("replication"),
        Some(json!({"Rule": [{
            "ID": "dr",
            "Status": "Enabled",
            "Destination": {"Bucket": "arn:obio:replication:::nowhere"},
        }]})),
    );
    r.expect(400);
    assert_eq!(code(&r), "InvalidArgument", "{}", r.text());

    // Object lock on the (versioned) bucket, with a default retention; the
    // listing shows it, and an unlocked bucket as off.
    let lock = json!({
        "ObjectLockEnabled": "Enabled",
        "Rule": {"DefaultRetention": {"Mode": "GOVERNANCE", "Days": 7}},
    });
    console(&c, &session, "PUT", &at("object-lock"), Some(lock.clone())).expect(204);
    let r = console(&c, &session, "GET", &at("object-lock"), None);
    r.expect(200);
    assert_eq!(r.json(), lock);
    c.json("POST", "/_admin/buckets", json!({"name": "plain"}))
        .expect_ok();
    let listed = console(&c, &session, "GET", "/_admin/buckets", None);
    listed.expect(200);
    let lock_of = |name: &str| -> Value {
        listed.json()["buckets"]
            .as_array()
            .unwrap()
            .iter()
            .find(|b| b["name"] == name)
            .unwrap_or_else(|| panic!("{name} not listed"))["object_lock"]
            .clone()
    };
    assert_eq!(
        lock_of("photos"),
        json!({"enabled": true, "default_retention": {"mode": "GOVERNANCE", "days": 7}})
    );
    assert_eq!(lock_of("plain"), json!({"enabled": false}));
    // Locked, versioning can't be suspended: S3's refusal, as JSON.
    let r = console(
        &c,
        &session,
        "PUT",
        &at("versioning"),
        Some(json!({"Status": "Suspended"})),
    );
    r.expect(409);
    assert_eq!(code(&r), "InvalidBucketState");

    // No such bucket; no credentials at all.
    let r = console(&c, &session, "GET", "/_admin/buckets/nope/versioning", None);
    r.expect(404);
    assert_eq!(code(&r), "NoSuchBucket");
    let r = Response::from(
        http_client()
            .get(format!("{}{}", c.endpoint, at("versioning")))
            .send()
            .unwrap(),
    );
    r.expect(401);
}

/// A tenant's admin reaches its own buckets' settings, by key or by console
/// session, and no other tenant's, nor the system's.
#[test]
fn a_tenant_admin_is_confined_to_its_own_buckets_settings() {
    let c = Cluster::start();
    let (ak, sk) = tenant_admin(&c, "acme");
    let (gk, gs) = tenant_admin(&c, "globex");
    c.request_as(
        "POST",
        "/_admin/buckets",
        json!({"name": "acme-data"}).to_string().as_bytes(),
        &ak,
        &sk,
    )
    .expect_ok();
    c.json("POST", "/_admin/buckets", json!({"name": "system-data"}))
        .expect_ok();
    let enable = json!({"Status": "Enabled"}).to_string();

    // Its own: by key and by session.
    c.request_as(
        "PUT",
        "/_admin/buckets/acme-data/versioning",
        enable.as_bytes(),
        &ak,
        &sk,
    )
    .expect(204);
    let acme = key_login(&c, &ak, &sk);
    let r = console(
        &c,
        &acme,
        "GET",
        "/_admin/buckets/acme-data/versioning",
        None,
    );
    r.expect(200);
    assert_eq!(r.json(), json!({"Status": "Enabled"}));

    // Another tenant's admin: refused, by key and by session, reading and
    // writing every setting.
    let globex = key_login(&c, &gk, &gs);
    for setting in [
        "versioning",
        "object-lock",
        "encryption",
        "lifecycle",
        "replication",
    ] {
        let path = format!("/_admin/buckets/acme-data/{setting}");
        for method in ["GET", "PUT"] {
            let by_key = c.request_as(method, &path, b"{}", &gk, &gs);
            assert_eq!(
                by_key.status,
                403,
                "{method} {path} by key: {}",
                by_key.text()
            );
            assert_eq!(code(&by_key), "AccessDenied");
            let by_session = console(&c, &globex, method, &path, Some(json!({})));
            assert_eq!(
                by_session.status,
                403,
                "{method} {path} by session: {}",
                by_session.text()
            );
        }
    }
    let r = c.request_as(
        "DELETE",
        "/_admin/buckets/acme-data/lifecycle",
        &[],
        &gk,
        &gs,
    );
    assert_eq!(r.status, 403, "{}", r.text());

    // Nor the system's buckets.
    let r = c.request_as(
        "PUT",
        "/_admin/buckets/system-data/versioning",
        enable.as_bytes(),
        &ak,
        &sk,
    );
    assert_eq!(r.status, 403, "{}", r.text());

    // Nothing changed: acme's bucket is as acme left it, the system's never
    // versioned.
    let r = c.request("GET", "/_admin/buckets/acme-data/versioning", &[]);
    assert_eq!(r.json(), json!({"Status": "Enabled"}));
    let r = c.request("GET", "/_admin/buckets/system-data/versioning", &[]);
    assert_eq!(r.json(), json!({}));
}
