//! The REST APIs beside S3 (Iceberg REST, Unity Catalog, the admin API)
//! take a request signed as standard `SigV4` for any service but S3 is
//! signed: over the SHA-256 of its body, with no `x-amz-content-sha256`
//! header. That is how botocore's generic `SigV4Auth` signs, and so
//! `PyIceberg` with `rest.sigv4-enabled`, whose first call is a GET of
//! `/iceberg/v1/config`. The signature covers the body: one changed
//! after it was signed is refused.

use objectio_e2e::Cluster;
use serde_json::json;

fn names(r: &objectio_e2e::Response) -> Vec<String> {
    r.json()["namespaces"]
        .as_array()
        .expect("namespaces")
        .iter()
        .map(|n| n[0].as_str().expect("name").to_string())
        .collect()
}

#[test]
fn a_signature_over_the_unsent_body_hash_is_accepted() {
    let c = Cluster::start();

    // The admin API.
    let wh = json!({"name": "hashed"}).to_string();
    c.request_hashing_body("POST", "/_admin/warehouses", wh.as_bytes(), wh.as_bytes())
        .expect_ok();

    // Iceberg REST: PyIceberg's first call, a GET signed over the empty
    // body's hash.
    let r = c.request_hashing_body("GET", "/iceberg/v1/config?warehouse=hashed", b"", b"");
    r.expect(200);
    assert!(
        r.json()["overrides"]["prefix"].is_string() || r.json()["defaults"].is_object(),
        "a catalog config: {}",
        r.text()
    );
    // A POST with a JSON body: create namespace.
    let ns = json!({"namespace": ["signed"], "properties": {}}).to_string();
    c.request_hashing_body(
        "POST",
        "/iceberg/v1/namespaces?warehouse=hashed",
        ns.as_bytes(),
        ns.as_bytes(),
    )
    .expect_ok();
    let listed = c.request_hashing_body("GET", "/iceberg/v1/namespaces?warehouse=hashed", b"", b"");
    listed.expect(200);
    assert_eq!(names(&listed), ["signed"]);
    // The warehouse-prefixed path a client uses after /v1/config.
    c.request_hashing_body("GET", "/iceberg/v1/ws/hashed/namespaces", b"", b"")
        .expect(200);

    // Unity Catalog.
    let cat = json!({"name": "hashedcat"}).to_string();
    c.request_hashing_body(
        "POST",
        "/api/2.1/unity-catalog/catalogs",
        cat.as_bytes(),
        cat.as_bytes(),
    )
    .expect_ok();
    let r = c.request_hashing_body("GET", "/api/2.1/unity-catalog/catalogs/hashedcat", b"", b"");
    r.expect(200);
    assert_eq!(r.json()["name"], "hashedcat");
}

#[test]
fn a_body_changed_after_it_was_signed_is_refused() {
    let c = Cluster::start();
    c.json("POST", "/_admin/warehouses", json!({"name": "tamper"}))
        .expect_ok();

    let signed = json!({"namespace": ["signed"], "properties": {}}).to_string();
    let altered = json!({"namespace": ["altered"], "properties": {}}).to_string();
    let r = c.request_hashing_body(
        "POST",
        "/iceberg/v1/namespaces?warehouse=tamper",
        signed.as_bytes(),
        altered.as_bytes(),
    );
    assert_eq!(r.status, 401, "altered CreateNamespace: {}", r.text());
    let listed = c.request("GET", "/iceberg/v1/namespaces?warehouse=tamper", &[]);
    listed.expect(200);
    assert!(
        names(&listed).is_empty(),
        "nothing created: {}",
        listed.text()
    );

    let signed = json!({"name": "signedcat"}).to_string();
    let altered = json!({"name": "alteredcat"}).to_string();
    let r = c.request_hashing_body(
        "POST",
        "/api/2.1/unity-catalog/catalogs",
        signed.as_bytes(),
        altered.as_bytes(),
    );
    assert_eq!(r.status, 401, "altered CreateCatalog: {}", r.text());
    c.request("GET", "/api/2.1/unity-catalog/catalogs/alteredcat", &[])
        .expect(404);

    let signed = json!({"name": "signedwh"}).to_string();
    let altered = json!({"name": "alteredwh"}).to_string();
    let r = c.request_hashing_body(
        "POST",
        "/_admin/warehouses",
        signed.as_bytes(),
        altered.as_bytes(),
    );
    assert_eq!(r.status, 403, "altered admin call: {}", r.text());
    assert!(r.text().contains("SignatureDoesNotMatch"), "{}", r.text());
    let r = c.request("GET", "/_admin/warehouses", &[]);
    r.expect(200);
    assert!(
        !r.text().contains("alteredwh"),
        "nothing created: {}",
        r.text()
    );
}

/// A body signed over its hash without the hash sent is read whole to
/// check it, so it is bounded; past the bound the answer says so.
#[test]
fn a_body_too_large_to_hash_is_refused_with_413() {
    let c = Cluster::start();
    c.json("POST", "/_admin/warehouses", json!({"name": "big"}))
        .expect_ok();
    let pad = "x".repeat(3 * 1024 * 1024);
    let body = json!({"namespace": ["big"], "properties": {"pad": pad}}).to_string();
    let r = c.request_hashing_body(
        "POST",
        "/iceberg/v1/namespaces?warehouse=big",
        body.as_bytes(),
        body.as_bytes(),
    );
    assert_eq!(r.status, 413, "{}", r.text());
    assert!(r.text().contains("x-amz-content-sha256"), "{}", r.text());
    let r = c.request_hashing_body(
        "POST",
        "/_admin/warehouses",
        body.as_bytes(),
        body.as_bytes(),
    );
    assert_eq!(r.status, 413, "{}", r.text());
}
