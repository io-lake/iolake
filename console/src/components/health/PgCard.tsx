import { Link } from "react-router-dom";
import type { Protection } from "../../api/protection";
import { ecLabel, type PoolInfo } from "./data";
import { count, plural } from "./format";

const PARTS = [
  { key: "clean", label: "Clean", meaning: "all shards in place", swatch: "bg-ok" },
  { key: "rebuilding", label: "Rebuilding", meaning: "missing a shard, being repaired", swatch: "bg-warn-dot" },
  { key: "atRisk", label: "At risk", meaning: "one more loss is data loss", swatch: "bg-err" },
] as const;

/// Placement groups by how well protected they are: a segmented bar, the
/// three counts with what each means, and the same split per pool.
export default function PgCard({ p, pools }: { p: Protection; pools: PoolInfo[] }) {
  const layout = new Map(pools.map((x) => [x.name, x]));
  const label = `${count(p.clean)} clean, ${count(p.rebuilding)} rebuilding, ${count(p.atRisk)} at risk`;
  return (
    <section
      aria-label="Placement groups"
      className="bg-surface border border-border rounded-card shadow-card min-w-0 overflow-hidden flex flex-col"
    >
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[13px] font-semibold text-text">Placement groups</h2>
          <span className="text-[12px] text-muted tabular-nums">
            {count(p.total)} across {plural(p.pools.length, "pool")}
          </span>
        </div>
        {p.total > 0 ? (
          <div role="img" aria-label={label} className="flex h-2.5 rounded-[5px] overflow-hidden gap-0.5">
            {PARTS.map((part) =>
              p[part.key] > 0 ? (
                <span key={part.key} className={part.swatch} style={{ flex: p[part.key] }} />
              ) : null,
            )}
          </div>
        ) : (
          <div className="h-2.5 rounded-[5px] bg-surface-2 border border-border" />
        )}
        <div className="grid grid-cols-3 gap-3">
          {PARTS.map((part) => (
            <div key={part.key} className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-[2px] ${part.swatch}`} aria-hidden="true" />
                <span className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
                  {part.label}
                </span>
              </div>
              <div className="font-display text-[24px] leading-7 font-semibold text-text tabular-nums">
                {count(p[part.key])}
              </div>
              <div className="text-[11.5px] text-muted">{part.meaning}</div>
            </div>
          ))}
        </div>
        {p.total === 0 && (
          <p className="text-[12px] text-muted">
            No placement groups yet. A pool gets its groups when it is created and OSDs are in service.
          </p>
        )}
      </div>

      {p.pools.length > 0 && (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-surface-2">
                {["Pool", "Layout", "Groups", "Clean", "Rebuilding", "At risk"].map((h, i) => (
                  <th
                    key={h}
                    scope="col"
                    className={`px-3.5 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted whitespace-nowrap ${
                      i >= 2 ? "text-right" : "text-left"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.pools.map((pp) => {
                const l = layout.get(pp.pool);
                return (
                  <tr key={pp.pool} className="border-t border-border">
                    <td className="px-3.5 py-2 h-9 text-[12px]">
                      <Link
                        to={`/cluster/pools/${encodeURIComponent(pp.pool)}`}
                        className="font-mono text-accent hover:underline"
                      >
                        {pp.pool}
                      </Link>
                    </td>
                    <td className="px-3.5 py-2 text-[12px] text-text-2 whitespace-nowrap">
                      {l ? (
                        <>
                          <span className="font-mono">{ecLabel(l)}</span>
                          {l.failure_domain && (
                            <span className="text-muted"> · per {l.failure_domain}</span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3.5 py-2 text-[12px] text-text-2 text-right tabular-nums">
                      {count(pp.total)}
                    </td>
                    <td className="px-3.5 py-2 text-[12px] text-text-2 text-right tabular-nums">
                      {count(pp.clean)}
                    </td>
                    <td
                      className={`px-3.5 py-2 text-[12px] text-right tabular-nums ${
                        pp.rebuilding ? "text-warn font-medium" : "text-text-2"
                      }`}
                    >
                      {count(pp.rebuilding)}
                    </td>
                    <td
                      className={`px-3.5 py-2 text-[12px] text-right tabular-nums ${
                        pp.atRisk ? "text-err font-medium" : "text-text-2"
                      }`}
                    >
                      {count(pp.atRisk)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
