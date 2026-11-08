//! Per-bucket request rate limiting: a bucket over its configured rate is
//! refused `429 Too Many Requests` with `Retry-After`, and a bucket with no
//! limit set is never touched — the isolation that is the point of the feature.

use iolake_e2e::Cluster;
use serde_json::json;

/// Fire `n` signed GETs at `/{bucket}/k` back to back; count the `429`s.
fn hammer(c: &Cluster, bucket: &str, n: u32) -> usize {
    (0..n)
        .filter(|_| c.request("GET", &format!("/{bucket}/k"), b"").status == 429)
        .count()
}

#[test]
fn a_bucket_over_its_rate_is_throttled_and_others_are_not() {
    let c = Cluster::start();

    // A limited bucket and an unlimited one, each with one object to GET.
    for b in ["rated", "free"] {
        c.json("POST", "/_admin/buckets", json!({ "name": b }))
            .expect_ok();
        c.request("PUT", &format!("/{b}/k"), b"x").expect_ok();
    }

    // One token, no burst: the first GET passes, the rest in a tight loop 429.
    c.json(
        "PUT",
        "/_admin/buckets/rated/rate-limit",
        json!({ "rps": 1, "burst": 1 }),
    )
    .expect(204);

    assert!(
        hammer(&c, "rated", 6) >= 1,
        "a bucket over its rate must be throttled"
    );
    assert_eq!(
        hammer(&c, "free", 6),
        0,
        "a bucket with no limit must never be throttled"
    );

    // The refusal is a 429 that tells the client how long to wait.
    let mut r = c.request("GET", "/rated/k", b"");
    for _ in 0..6 {
        if r.status == 429 {
            break;
        }
        r = c.request("GET", "/rated/k", b"");
    }
    assert_eq!(r.status, 429);
    assert!(r.header("retry-after").is_some(), "429 carries Retry-After");

    // Clearing the limit lets it through again.
    c.json(
        "PUT",
        "/_admin/buckets/rated/rate-limit",
        json!({ "rps": 0, "burst": 0 }),
    )
    .expect(204);
    assert_eq!(
        hammer(&c, "rated", 6),
        0,
        "a cleared limit stops throttling"
    );
}

#[test]
fn a_tenant_limit_covers_all_its_buckets_and_not_other_tenants() {
    let c = Cluster::start();

    // Two tenants; two buckets in the first, one in the second. The buckets
    // are owned by the system admin (so it can GET them) but carry the tenant.
    for t in ["acme", "globex"] {
        c.json(
            "POST",
            "/_admin/tenants",
            json!({ "name": t, "display_name": t, "enabled": true }),
        )
        .expect_ok();
    }
    for (name, tenant) in [
        ("acme-a", "acme"),
        ("acme-b", "acme"),
        ("globex-a", "globex"),
    ] {
        c.json(
            "POST",
            "/_admin/buckets",
            json!({ "name": name, "tenant": tenant }),
        )
        .expect_ok();
        c.request("PUT", &format!("/{name}/k"), b"x").expect_ok();
    }

    // One token for the whole acme tenant, none for globex.
    c.json(
        "PUT",
        "/_admin/tenants/acme/rate-limit",
        json!({ "rps": 1, "burst": 1 }),
    )
    .expect(204);

    // The tenant ceiling is shared: requests spread across acme's two buckets
    // still exhaust the single tenant token, so some are throttled.
    let throttled = hammer(&c, "acme-a", 3) + hammer(&c, "acme-b", 3);
    assert!(
        throttled >= 1,
        "a tenant over its rate must be throttled across its buckets"
    );

    // A bucket in another tenant is untouched.
    assert_eq!(hammer(&c, "globex-a", 6), 0, "another tenant is unaffected");
}
