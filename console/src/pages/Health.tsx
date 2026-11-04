import PageHeader from "../components/PageHeader";
import { useProtection } from "../api/protection";

/// Cluster health: data protection, repair, and the drives under it.
export default function Health() {
  const p = useProtection();
  return (
    <div className="px-8 py-6">
      <PageHeader title="Cluster health" description="Data protection, repair, and the drives under it" />
      {p && (
        <p className="text-[13px] text-text-2">
          {p.clean} of {p.total} placement groups clean · {p.rebuilding} rebuilding · {p.atRisk} at risk
        </p>
      )}
    </div>
  );
}
