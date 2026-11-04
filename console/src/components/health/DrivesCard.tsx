import { useId, useState } from "react";
import { X } from "lucide-react";
import { nodes as nodesApi, type OsdAdminState } from "../../api/client";
import { Badge, Banner, Button, CapacityBar } from "../ui";
import type { ClusterSnapshot, Drive, HostGroup } from "./data";
import Progress from "./Progress";
import { ago, bytes, count, pct, plural } from "./format";
import { DRIVE_STATES, LEGEND_ORDER, hostStatus } from "./states";

/// Every drive (OSD) laid out by rack and host, each a small tile showing its
/// fill. Selecting one shows its detail and the admin-state actions.
export default function DrivesCard({
  snap,
  onChanged,
}: {
  snap: ClusterSnapshot;
  onChanged: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const drive = selected ? snap.drives.find((d) => d.id === selected) : undefined;
  const { drives, hosts, racks, racksConfigured } = snap;

  const summary =
    drives.length === 0
      ? "No drives registered."
      : racksConfigured
        ? `${plural(drives.length, "drive")} on ${plural(hosts.length, "host")} in ${plural(racks.length, "rack")}.`
        : `${plural(drives.length, "drive")} on ${plural(hosts.length, "host")}.`;

  return (
    <section
      aria-label="Drives by rack and host"
      className="bg-surface border border-border rounded-card shadow-card min-w-0 flex flex-col"
    >
      <div className="p-4 flex flex-col gap-3.5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-text">Drives</h2>
            <p className="text-[12px] text-muted">
              {summary}
              {drives.length > 0 && !racksConfigured && (
                <>
                  {" "}
                  No racks configured, so drives are grouped by host. Set <code className="font-mono">rack</code> in
                  each OSD's failure domain to spread stripes across racks.
                </>
              )}
            </p>
          </div>
          {drives.length > 0 && <Legend />}
        </div>

        {drives.length === 0 ? (
          <p className="text-[13px] text-text-2 py-6 text-center">
            No OSDs have registered with the metadata service yet. Start one and it appears here.
          </p>
        ) : racksConfigured ? (
          <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))]">
            {racks.map((r) => (
              <div
                key={r.name}
                className="border border-border rounded-[10px] p-3 flex flex-col gap-2.5 bg-surface-2 min-w-0"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-text-2">
                    {r.name}
                  </h3>
                  <span className="text-[11.5px] text-muted tabular-nums">
                    {plural(r.drives, "drive")} · {bytes(r.total)}
                  </span>
                </div>
                {r.hosts.map((h) => (
                  <HostTiles key={h.name} h={h} selected={selected} onSelect={setSelected} />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))]">
            {hosts.map((h) => (
              <div
                key={h.name}
                className="border border-border rounded-[10px] p-3 bg-surface-2 min-w-0"
              >
                <HostTiles h={h} selected={selected} onSelect={setSelected} />
              </div>
            ))}
          </div>
        )}
      </div>

      {drive && (
        <DriveDetail
          key={drive.id}
          d={drive}
          now={snap.loadedAt}
          onClose={() => setSelected(null)}
          onChanged={onChanged}
        />
      )}
    </section>
  );
}

function Legend() {
  return (
    <ul className="flex gap-x-3.5 gap-y-1.5 flex-wrap text-[11.5px] text-text-2" aria-label="Drive states">
      {LEGEND_ORDER.map((s) => {
        const st = DRIVE_STATES[s];
        return (
          <li key={s} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`relative w-3.5 h-3.5 rounded-[4px] overflow-hidden inline-block ${st.tile}`}
            >
              {st.fill && <span className="absolute inset-x-0 bottom-0 h-[60%] bg-accent-soft" />}
            </span>
            {s === "up" ? "Up, fill shown" : st.label}
          </li>
        );
      })}
    </ul>
  );
}

function HostTiles({
  h,
  selected,
  onSelect,
}: {
  h: HostGroup;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const st = hostStatus(h);
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center justify-between gap-2 text-[12px]">
        <span className="font-mono font-medium text-text truncate">{h.name}</span>
        <Badge kind={st.kind}>{st.label}</Badge>
      </div>
      <div className="flex flex-wrap gap-1">
        {h.drives.map((d) => (
          <Tile
            key={d.id}
            d={d}
            selected={selected === d.id}
            onClick={() => onSelect(selected === d.id ? null : d.id)}
          />
        ))}
      </div>
    </div>
  );
}

function Tile({ d, selected, onClick }: { d: Drive; selected: boolean; onClick: () => void }) {
  const tip = useId();
  const st = DRIVE_STATES[d.state];
  const used = pct(d.used, d.total);
  const fill = st.fill && d.total > 0;
  const admin = d.admin === "in" ? "in service" : d.admin;
  return (
    <span className="relative group/tile">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        aria-label={`${d.name}, ${st.label.toLowerCase()}, ${admin}${d.total > 0 ? `, ${used}% used` : ""}`}
        aria-describedby={tip}
        className={`relative w-8 h-8 rounded-[6px] overflow-hidden inline-flex items-center justify-center
          cursor-pointer ${st.tile} ${selected ? "ring-2 ring-accent ring-offset-1 ring-offset-surface" : ""}`}
      >
        {fill && (
          <span
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 bg-accent-soft"
            style={{ height: `${Math.max(used, 4)}%` }}
          />
        )}
        <span aria-hidden="true" className={`relative font-mono text-[9px] font-medium tracking-tight ${st.text}`}>
          {d.short}
        </span>
      </button>
      <span
        id={tip}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-20 hidden
          group-hover/tile:block group-has-[:focus-visible]/tile:block whitespace-nowrap bg-surface text-text
          border border-border-strong rounded-[6px] shadow-pop px-2 py-1 text-[11px] leading-4"
      >
        <span className="block font-mono">{d.name}</span>
        <span className="block text-text-2">
          {st.label}
          {d.state !== d.admin ? ` · ${admin}` : ""}
          {d.total > 0 ? ` · ${used}% used` : ""}
        </span>
      </span>
    </span>
  );
}

function DriveDetail({
  d,
  now,
  onClose,
  onChanged,
}: {
  d: Drive;
  now: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<OsdAdminState | null>(null);
  const [confirmOut, setConfirmOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const st = DRIVE_STATES[d.state];

  const setState = async (target: OsdAdminState) => {
    setBusy(target);
    setError(null);
    try {
      await nodesApi.setAdminState(d.id, target);
      setConfirmOut(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const drain = d.drain;
  const initial = drain ? Math.max(drain.initial_shards, drain.shards_remaining) : 0;
  const moved = drain ? Math.max(0, initial - drain.shards_remaining) : 0;

  return (
    <div className="border-t border-border p-4 flex flex-col gap-3.5" aria-label={`Drive ${d.name}`} role="region">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="font-mono text-[13px] font-semibold text-text">{d.name}</h3>
        <Badge kind={st.badge}>{st.label}</Badge>
        <span className="text-[12px] text-muted">
          on <span className="font-mono">{d.host}</span>
          {d.rack && !["default", "(none)"].includes(d.rack) && (
            <>
              {" "}
              in <span className="font-mono">{d.rack}</span>
            </>
          )}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close drive details"
          className="ml-auto p-1 rounded-[6px] text-muted hover:text-text hover:bg-surface-2"
        >
          <X size={14} />
        </button>
      </div>

      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))]">
        <div className="flex flex-col gap-2 min-w-0">
          <p className="text-[13px] text-text tabular-nums">
            <span className="font-display text-[20px] font-semibold">{bytes(d.used)}</span>{" "}
            <span className="text-muted text-[12px]">
              of {bytes(d.total)} · {pct(d.used, d.total)}%{d.stale ? " · as last reported" : ""}
            </span>
          </p>
          <CapacityBar used={d.used} total={d.total} />
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px] mt-1">
            <dt className="text-muted">Status</dt>
            <dd className="text-text-2">{d.online ? "Up, answering" : "Down, not answering"}</dd>
            <dt className="text-muted">Admin state</dt>
            <dd className="text-text-2">
              {d.admin === "in"
                ? "In: takes new data"
                : d.admin === "draining"
                  ? "Draining: its shards are moving off, then it is marked out"
                  : "Out: takes no data"}
            </dd>
            <dt className="text-muted">Shards</dt>
            <dd className="text-text-2 tabular-nums">{count(d.shards)}</dd>
            <dt className="text-muted">OSD id</dt>
            <dd className="font-mono text-[11px] text-text-2 break-all">{d.id}</dd>
            <dt className="text-muted">Address</dt>
            <dd className="font-mono text-[11px] text-text-2 break-all">{d.address.replace(/^https?:\/\//, "")}</dd>
            {d.version && (
              <>
                <dt className="text-muted">Version</dt>
                <dd className="font-mono text-[11px] text-text-2">{d.version}</dd>
              </>
            )}
          </dl>
        </div>

        <div className="flex flex-col gap-2 min-w-0">
          <h4 className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
            Disks
          </h4>
          {d.disks.length === 0 ? (
            <p className="text-[12px] text-muted">
              {d.online ? "This OSD reports no disks." : "Unknown while the OSD is down."}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {d.disks.map((k) => (
                <li key={k.disk_id} className="flex flex-col gap-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[11px] text-text-2 truncate" title={k.path}>
                      {k.path || k.disk_id.slice(0, 8)}
                    </span>
                    <Badge kind={k.status === "healthy" ? "ok" : "err"} className="shrink-0">
                      {k.status ? k.status.charAt(0).toUpperCase() + k.status.slice(1) : "Unknown"}
                    </Badge>
                  </div>
                  <span className="text-[11px] text-muted tabular-nums">
                    {bytes(k.used_capacity)} of {bytes(k.total_capacity)} · {plural(k.shard_count, "shard")}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {drain && (
            <div className="flex flex-col gap-1 mt-1">
              <h4 className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
                Drain
              </h4>
              <Progress done={moved} total={initial} label={`Drain of ${d.name}`} />
              <span className="text-[11px] text-muted tabular-nums">
                {count(moved)} of {plural(initial, "shard")} moved · checked {ago(drain.updated_at, now)}
              </span>
              {drain.last_error && <span className="text-[11px] text-err">{drain.last_error}</span>}
            </div>
          )}
        </div>
      </div>

      {error && <Banner kind="err" title="The change didn't go through">{error}</Banner>}

      {confirmOut ? (
        <div className="flex items-center gap-2 flex-wrap border border-border rounded-control bg-surface-2 px-3 py-2">
          <span className="text-[12px] text-text-2 flex-1 min-w-[200px]">
            Mark {d.name} out now? Its shards are rebuilt on other drives from parity, and the groups it
            held stay degraded until that finishes. Draining moves them first.
          </span>
          <Button size="sm" variant="ghost" onClick={() => setConfirmOut(false)} disabled={busy !== null}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" onClick={() => void setState("out")} disabled={busy !== null}>
            {busy === "out" ? "Marking out…" : "Mark out"}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          {d.admin === "in" ? (
            <>
              <Button size="sm" onClick={() => void setState("draining")} disabled={busy !== null}>
                {busy === "draining" ? "Starting drain…" : "Drain"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmOut(true)} disabled={busy !== null}>
                Mark out
              </Button>
              <span className="text-[11px] text-muted">
                Drain moves its shards off, then marks it out.
              </span>
            </>
          ) : (
            <Button size="sm" onClick={() => void setState("in")} disabled={busy !== null}>
              {busy === "in" ? "Marking in…" : "Mark in"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
