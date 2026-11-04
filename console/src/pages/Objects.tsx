import { Navigate, useSearchParams } from "react-router-dom";

/// The object browser is the Objects tab of a bucket's page now. This keeps
/// old `/objects?bucket=…&prefix=…` links working: they land on that tab, at
/// that prefix, and a bare `/objects` lands on the bucket list.
export default function Objects() {
  const [params] = useSearchParams();
  const bucket = params.get("bucket");
  const prefix = params.get("prefix");
  if (!bucket) return <Navigate to="/buckets" replace />;
  const qs = prefix ? `?${new URLSearchParams({ prefix })}` : "";
  return <Navigate to={`/buckets/${encodeURIComponent(bucket)}${qs}`} replace />;
}
