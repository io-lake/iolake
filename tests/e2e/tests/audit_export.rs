//! Audit export/search (`GET /_admin/audit/events`): tenant-scoped, filterable by api, downloadable as CSV, and 409 when no system bucket is configured.

use iolake_e2e::{Cluster, Response, http_client};
use serde_json::{Value, json};
use std::time::{Duration, Instant};

/// Every event currently in the system audit bucket (read as the system admin).
fn system_bucket_events(c: &Cluster, bucket: &str) -> Vec<Value> {
    let list = c
        .request("GET", &format!("/{bucket}?list-type=2"), &[])
        .text();
    list.split("<Key>")
        .skip(1)
        .filter_map(|s| s.split("</Key>").next())
        .flat_map(|key| {
            c.request("GET", &format!("/{bucket}/{key}"), &[])
                .text()
                .lines()
                .filter_map(|l| serde_json::from_str::<Value>(l).ok())
                .collect::<Vec<_>>()
        })
        .collect()
}

#[test]
fn audit_export_is_tenant_scoped_and_filterable() {
    let c = Cluster::start_with_ec_and_args(6, 4, 2, &["--audit-system-bucket", "objectio-audit"]);

    // Two tenants, a bucket in each (admin-owned so the test can drive it, but
    // carrying the tenant), and a couple of requests to generate audit events.
    for (t, b) in [("acme", "acme-logs"), ("globex", "globex-logs")] {
        c.json(
            "POST",
            "/_admin/tenants",
            json!({ "name": t, "display_name": t, "enabled": true }),
        )
        .expect_ok();
        c.json("POST", "/_admin/buckets", json!({ "name": b, "tenant": t }))
            .expect_ok();
        c.request("PUT", &format!("/{b}/k1"), b"x").expect_ok();
        c.request("GET", &format!("/{b}/k1"), &[]).expect(200);
    }

    // Wait until both buckets' events are in the system bucket.
    let deadline = Instant::now() + Duration::from_secs(40);
    let evs = loop {
        let evs = system_bucket_events(&c, "objectio-audit");
        let has = |b: &str| evs.iter().any(|e| e["bucket"].as_str() == Some(b));
        if has("acme-logs") && has("globex-logs") {
            break evs;
        }
        assert!(
            Instant::now() < deadline,
            "audit events never reached the system bucket"
        );
        std::thread::sleep(Duration::from_millis(300));
    };

    // A tight range around the observed events.
    let mut times: Vec<&str> = evs.iter().filter_map(|e| e["time"].as_str()).collect();
    times.sort_unstable();
    let from = times.first().copied().unwrap();
    let to = times.last().copied().unwrap();
    let q = |extra: &str| format!("/_admin/audit/events?from={from}&to={to}&limit=1000{extra}");
    let arr = |path: &str| {
        c.request("GET", path, &[])
            .json()
            .as_array()
            .cloned()
            .unwrap()
    };

    // System admin, no tenant filter: both tenants present.
    let all = arr(&q(""));
    assert!(all.iter().any(|e| e["bucket"] == "acme-logs"));
    assert!(all.iter().any(|e| e["bucket"] == "globex-logs"));

    // ?tenant=acme: only acme, by either tenant field; globex never leaks.
    let acme = arr(&q("&tenant=acme"));
    assert!(!acme.is_empty());
    assert!(
        acme.iter()
            .all(|e| e["bucket_tenant"] == "acme" || e["principal"]["tenant"] == "acme"),
        "a non-acme event leaked into the acme scope"
    );
    assert!(acme.iter().any(|e| e["bucket"] == "acme-logs"));
    assert!(!acme.iter().any(|e| e["bucket"] == "globex-logs"));

    // api filter: our events are s3, so iceberg returns none of them.
    let iceberg = arr(&q("&api=iceberg"));
    assert!(!iceberg.iter().any(|e| e["bucket"] == "acme-logs"));

    // CSV download carries the header row.
    let csv = c.request("GET", &q("&format=csv"), &[]);
    assert!(csv.text().starts_with("time,api,method"));
}

#[test]
fn audit_export_without_a_system_bucket_is_409() {
    let c = Cluster::start_with_ec_and_args(6, 4, 2, &[]);
    let r = c.request(
        "GET",
        "/_admin/audit/events?from=2026-01-01T00:00:00Z&to=2026-01-01T01:00:00Z",
        &[],
    );
    assert_eq!(r.status, 409);
}

/// Console sign-in with a key: the session cookie value.
fn key_login(c: &Cluster, ak: &str, sk: &str) -> String {
    let r = http_client()
        .post(format!("{}/_console/api/login", c.endpoint))
        .header("Content-Type", "application/json")
        .body(json!({ "accessKey": ak, "secretKey": sk }).to_string())
        .send()
        .unwrap();
    assert_eq!(r.status().as_u16(), 200, "tenant-admin login");
    r.headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find_map(|c| c.split(';').next()?.strip_prefix("iolake-session="))
        .expect("a session")
        .to_string()
}

/// A GET as the console makes it: the session cookie.
fn console_get(c: &Cluster, session: &str, path: &str) -> Response {
    Response::from(
        http_client()
            .get(format!("{}{path}", c.endpoint))
            .header("Cookie", format!("iolake-session={session}"))
            .send()
            .expect("request"),
    )
}

/// A tenant with an admin: the admin's (access_key, secret_key).
fn tenant_admin(c: &Cluster, tenant: &str) -> (String, String) {
    c.json(
        "POST",
        "/_admin/tenants",
        json!({ "name": tenant, "display_name": tenant, "enabled": true }),
    )
    .expect_ok();
    let user = c.json(
        "POST",
        "/_admin/users",
        json!({ "display_name": format!("{tenant}-admin"), "tenant": tenant }),
    );
    user.expect_ok();
    let user_id = user.json()["user_id"].as_str().unwrap().to_string();
    c.json(
        "POST",
        &format!("/_admin/tenants/{tenant}/admins"),
        json!({ "user_id": user_id }),
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

#[test]
fn a_tenant_admin_session_never_sees_another_tenant() {
    let c = Cluster::start_with_ec_and_args(6, 4, 2, &["--audit-system-bucket", "objectio-audit"]);

    // acme has a tenant admin; globex is a second tenant. Buckets in each, plus
    // the system admin's own actions, all produce audit events.
    let (ak, sk) = tenant_admin(&c, "acme");
    c.json(
        "POST",
        "/_admin/tenants",
        json!({ "name": "globex", "display_name": "globex", "enabled": true }),
    )
    .expect_ok();
    for (b, t) in [("acme-b", "acme"), ("globex-b", "globex")] {
        c.json("POST", "/_admin/buckets", json!({ "name": b, "tenant": t }))
            .expect_ok();
        c.request("PUT", &format!("/{b}/k"), b"x").expect_ok();
        c.request("GET", &format!("/{b}/k"), &[]).expect(200);
    }

    // Wait for both buckets' events to reach the system bucket.
    let deadline = Instant::now() + Duration::from_secs(40);
    let evs = loop {
        let evs = system_bucket_events(&c, "objectio-audit");
        let has = |b: &str| evs.iter().any(|e| e["bucket"].as_str() == Some(b));
        if has("acme-b") && has("globex-b") {
            break evs;
        }
        assert!(
            Instant::now() < deadline,
            "events never reached the system bucket"
        );
        std::thread::sleep(Duration::from_millis(300));
    };
    let mut times: Vec<&str> = evs.iter().filter_map(|e| e["time"].as_str()).collect();
    times.sort_unstable();
    let (from, to) = (
        times.first().copied().unwrap(),
        times.last().copied().unwrap(),
    );

    // The acme tenant admin's own console session, exactly as the browser sends it.
    let session = key_login(&c, &ak, &sk);
    let r = console_get(
        &c,
        &session,
        &format!("/_admin/audit/events?from={from}&to={to}&limit=1000"),
    );
    assert_eq!(r.status, 200, "acme admin audit query: {}", r.text());
    let seen = r.json().as_array().cloned().unwrap();

    assert!(
        seen.iter().any(|e| e["bucket"] == "acme-b"),
        "acme admin should see its own events"
    );
    assert!(
        !seen.iter().any(|e| e["bucket"] == "globex-b"),
        "LEAK: acme admin saw globex's events"
    );
    assert!(
        seen.iter()
            .all(|e| e["bucket_tenant"] == "acme" || e["principal"]["tenant"] == "acme"),
        "LEAK: acme admin saw an event belonging to no / another tenant"
    );
}
