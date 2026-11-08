//! Audit export/search (`GET /_admin/audit/events`): tenant-scoped, filterable by api, downloadable as CSV, and 409 when no system bucket is configured.

use iolake_e2e::Cluster;
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
