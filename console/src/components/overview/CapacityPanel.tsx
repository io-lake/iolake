import { Link } from "react-router-dom";
import { CapacityBar, Chip } from "../ui";
import type { NodeInfo } from "../../api/client";
import { hostName, osdName } from "./cluster";
import { bytes, percent, plural } from "./format";
import { Panel } from "./Panel";

interface Row {
  key: string;
  name: string;
  chip?: string;
  used: number;
  total: number;
  online: boolean;
}

/// Fill by host, or by OSD when every OSD is on one host. Pools aren't
/// shown: a pool's capacity is whatever its OSDs hold, and neither the pool
/// list nor the node list says which OSDs a pool's tags select, so a
/// pool's fill can't be read honestly from what the console has.
export default function CapacityPanel({ nodes }: { nodes: NodeInfo[] }) {
  // An OSD that doesn't answer reports neither its host nor its drives.
  const up = nodes.filter((n) => n.online);
  const down = nodes.filter((n) => !n.online);
  const hosts = new Map<string, NodeInfo[]>();
  for (const n of up) {
    const h = hostName(n);
    hosts.set(h, [...(hosts.get(h) ?? []), n]);
  }
  const byOsd = hosts.size <= 1;
  const sum = (ns: NodeInfo[], k: "used_capacity" | "total_capacity") =>
    ns.reduce((a, n) => a + (n.disks ?? []).reduce((b, d) => b + (d[k] ?? 0), 0), 0);

  const rows: Row[] = byOsd
    ? up.map((n) => ({
        key: n.node_id,
        name: osdName(n),
        chip: plural((n.disks ?? []).length, "drive"),
        used: sum([n], "used_capacity"),
        total: sum([n], "total_capacity"),
        online: n.online,
      }))
    : [...hosts.entries()].map(([h, ns]) => ({
        key: h,
        name: h,
        chip: plural(ns.length, "OSD"),
        used: sum(ns, "used_capacity"),
        total: sum(ns, "total_capacity"),
        online: ns.every((n) => n.online),
      }));
  rows.sort((a, b) => percent(b.used, b.total) - percent(a.used, a.total) || a.name.localeCompare(b.name));
  for (const n of down) {
    rows.push({ key: n.node_id, name: osdName(n), used: 0, total: 0, online: false });
  }

  return (
    <Panel
      title={byOsd ? "Capacity by OSD" : "Capacity by host"}
      action={
        <Link to="/cluster/drives" className="text-[12px] text-accent hover:underline">
          All drives
        </Link>
      }
    >
      {rows.length === 0 ? (
        <p className="px-4 pt-2 pb-4 text-[12px] text-muted">No OSDs have registered yet.</p>
      ) : (
        <ul className="flex flex-col gap-3.5 px-4 pt-3.5 pb-4">
          {rows.map((r) => {
            const pct = percent(r.used, r.total);
            const tone =
              pct >= 90 ? "text-err font-medium" : pct >= 75 ? "text-warn font-medium" : "text-muted";
            return (
              <li key={r.key} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono text-[12px] font-medium text-text truncate">{r.name}</span>
                    {r.chip && <Chip mono>{r.chip}</Chip>}
                  </span>
                  {r.online ? (
                    <span className={`text-[12px] tabular-nums whitespace-nowrap ${tone}`}>
                      {bytes(r.used)} of {bytes(r.total)}
                      {pct >= 75 && ` · ${Math.floor(pct)}%`}
                    </span>
                  ) : (
                    <span className="text-[12px] text-err whitespace-nowrap">Offline, capacity unknown</span>
                  )}
                </div>
                {r.online && <CapacityBar used={r.used} total={r.total} />}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
