import { Link } from "react-router-dom";
import { Badge } from "../ui";
import type { HostGroup } from "./data";
import { bytes, pct } from "./format";
import { hostStatus } from "./states";

/// One row per host: its rack, drives up of total, how full, its status.
export default function HostsTable({
  hosts,
  racksConfigured,
}: {
  hosts: HostGroup[];
  racksConfigured: boolean;
}) {
  const cols = ["Host", "Rack", "Drives up", "Used", "Status"];
  return (
    <section
      aria-label="Hosts"
      className="bg-surface border border-border rounded-card shadow-card min-w-0 overflow-hidden"
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-3">
        <h2 className="text-[13px] font-semibold text-text">Hosts</h2>
        <Link to="/cluster/drives" className="text-[12px] text-accent hover:underline">
          Nodes and drives
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-surface-2">
              {cols.map((h, i) => (
                <th
                  key={h}
                  scope="col"
                  className={`px-3.5 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted whitespace-nowrap ${
                    i === 2 || i === 3 ? "text-right" : "text-left"
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hosts.length === 0 && (
              <tr className="border-t border-border">
                <td colSpan={cols.length} className="px-3.5 py-6 text-center text-[12px] text-muted">
                  No hosts yet
                </td>
              </tr>
            )}
            {hosts.map((h) => {
              const st = hostStatus(h);
              const used = pct(h.used, h.total);
              return (
                <tr key={h.name} className="border-t border-border">
                  <td className="px-3.5 py-2 h-9 font-mono text-[12px] font-medium text-text whitespace-nowrap">
                    {h.name}
                  </td>
                  <td className="px-3.5 py-2 text-[12px] text-text-2 whitespace-nowrap">
                    {racksConfigured && h.rack ? <span className="font-mono">{h.rack}</span> : <span className="text-muted">none</span>}
                  </td>
                  <td
                    className={`px-3.5 py-2 text-[12px] text-right tabular-nums whitespace-nowrap ${
                      h.up < h.drives.length ? "text-err font-medium" : "text-text-2"
                    }`}
                  >
                    {h.up} / {h.drives.length}
                  </td>
                  <td
                    className="px-3.5 py-2 text-[12px] text-right tabular-nums whitespace-nowrap text-text-2"
                    title={`${bytes(h.used)} of ${bytes(h.total)}`}
                  >
                    <span className={used >= 90 ? "text-err font-medium" : used >= 75 ? "text-warn font-medium" : ""}>
                      {used}%
                    </span>
                    <span className="text-muted"> of {bytes(h.total)}</span>
                  </td>
                  <td className="px-3.5 py-2 text-[12px] whitespace-nowrap">
                    <Badge kind={st.kind}>{st.label}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
