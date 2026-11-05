#!/usr/bin/env bash
# Everything that needs Transfer Engine, in TCP mode (no RDMA hardware).
# Runs inside test.Dockerfile's image; CI's `rdma` job calls it.
set -euo pipefail

cargo test -p iolake-transport-te --features te
cargo test -p iolake-osd --features rdma rdma
cargo test -p iolake-gateway --features rdma rdma::

# The whole path, end to end: aio built with rdma, run with --rdma tcp. The
# tests are #[ignore]d (they need this build and IOLAKE_E2E_RDMA), so the
# e2e shards leave them out; --include-ignored runs them here.
cargo build -p iolake-aio --features rdma
IOLAKE_E2E_RDMA=tcp cargo test -p iolake-e2e --test rdma -- --include-ignored --test-threads=1
