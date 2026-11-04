import { Navigate } from "react-router-dom";

/// The Iceberg pages moved into the lakehouse catalog browser (`/catalog`).
/// Kept as a redirect until the route itself points there.
export default function IcebergCatalog() {
  return <Navigate to="/catalog" replace />;
}
