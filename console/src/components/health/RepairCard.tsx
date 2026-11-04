import { Link } from "react-router-dom";
import { classify, type Protection } from "../../api/protection";
import type { DrainStatus, PlacementGroup, RebalanceStatus } from "../../api/client";
import { Badge } from "../ui";
import Progress from "./Progress";
import { driveName, type Drive, type ScrubSummary } from "./data";
import { ago, bytes, count, duration, plural } from "./format";

const SHOWN = 8;
/// States in which a group can't serve at all; "no spare" would understate them.
const SEVERE = ["Down", "Incomplete"];

/// What recovery is doing now: the groups that aren't clean, drains in
/// flight, and the rebalancer; when there is nothing to do, when scrubs last
/// completed.
export default function RepairCard({
  p,
  drains,
  drives,
  rebalance,
  scrub,
  now,
}: {
  p: Protection;
  drains: DrainStatus[];
  drives: Drive[];
  rebalance: RebalanceStatus | null;
  scrub: ScrubSummary | null;
  now: number;
}) {
  const idle = p.notClean.length === 0 && drains.length === 0;
  const names = new Map(drives.map((d) => [d.id, d.name]));

  return (
    <section
      aria-label="Repair"
      className="bg-surface border border-border rounded-card shadow-card min-w-0 overflow-hidden flex flex-col"
    >
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[13px] font-semibold text-text">Repair</h2>
          {p.notClean.length > 0 && (
            <span className="text-[12px] text-muted tabular-nums">
              {plural(p.objectsRemaining, "object")} · {bytes(p.bytesRemaining)} left to rebuild
            </span>
          )}
        </div>
        {idle ? (
          <div className="flex items-center gap-2.5 py-3">
            <Badge kind="ok">Idle</Badge>
            <span className="text-[13px] text-text-2">Nothing to repair. Every group has all its shards.</span>
          </div>
        ) : p.notClean.length > 0 ? (
          <NotCleanSummary p={p} />
        ) : null}
      </div>

      {p.notClean.length > 0 && <GroupsTable pgs={p.notClean} now={now} />}

      {drains.length > 0 && (
        <div className="px-4 py-3 border-t border-border flex flex-col gap-2.5">
          <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
            Draining
          </h3>
          {drains.map((d) => (
            <DrainRow key={d.node_id} d={d} name={names.get(d.node_id) ?? driveName(d.node_id)} now={now} />
          ))}
        </div>
      )}

      <dl className="px-4 py-3 border-t border-border grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12px] mt-auto">
        <dt className="text-muted">Rebalancing</dt>
        <dd className="text-text-2 flex items-center gap-2 flex-wrap min-w-0">
          <RebalanceLine r={rebalance} now={now} />
        </dd>
        <dt className="text-muted">Scrubs</dt>
        <dd className="text-text-2 min-w-0">
          <ScrubLine s={scrub} now={now} />
        </dd>
      </dl>
    </section>
  );
}

/// How many groups are in each state, and why recovery isn't getting
/// further: the reason peering gave for the most severe stuck group, which is
/// usually what the operator has to fix.
function NotCleanSummary({ p }: { p: Protection }) {
  const states = new Map<string, number>();
  let stuck = 0;
  let first: PlacementGroup | null = null;
  for (const pg of p.notClean) {
    const st = pg.state?.state ?? "Unknown";
    states.set(st, (states.get(st) ?? 0) + 1);
    if (pg.state?.last_error) {
      stuck += 1;
      first ??= pg;
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] text-text-2">
        {plural(p.notClean.length, "group")} not clean:{" "}
        {[...states]
          .sort((a, b) => b[1] - a[1])
          .map(([st, n]) => `${count(n)} ${st.toLowerCase()}`)
          .join(", ")}
        {p.atRisk > 0 && (
          <span className="text-err font-medium"> · {count(p.atRisk)} with no spare shard left</span>
        )}
      </p>
      {first?.state && (
        <div className="text-[12px] rounded-control bg-surface-2 border border-border px-3 py-2">
          <span className="text-text font-medium">
            Recovery is stuck on {stuck === p.notClean.length ? "every group" : plural(stuck, "group")}.
          </span>{" "}
          <span className="text-text-2">
            For <span className="font-mono">{first.pool}/{first.pg_id}</span>: {reason(first.state.last_error)}
          </span>
        </div>
      )}
    </div>
  );
}

/// Peering's message, without the per-OSD detail it appends in parentheses
/// (the hex ids say nothing the reason doesn't).
function reason(e: string): string {
  return e.replace(/\s*\(position \d+ \([0-9a-f]+\):.*\)\s*$/, "");
}

function GroupsTable({ pgs, now }: { pgs: PlacementGroup[]; now: number }) {
  const shown = pgs.slice(0, SHOWN);
  const more = pgs.length - shown.length;
  return (
    <div className="overflow-x-auto border-t border-border">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-surface-2">
            {["Group", "State", "Left to rebuild", "Missing", "Since"].map((h, i) => (
              <th
                key={h}
                scope="col"
                className={`px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted whitespace-nowrap ${
                  i >= 2 ? "text-right" : "text-left"
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((pg) => {
            const s = pg.state;
            const risk = classify(pg) === "atRisk";
            return (
              <tr key={`${pg.pool}/${pg.pg_id}`} className="border-t border-border">
                <td className="px-3 py-2 h-9 text-[12px] whitespace-nowrap">
                  <Link
                    to={`/cluster/pools/${encodeURIComponent(pg.pool)}`}
                    className="font-mono text-accent hover:underline"
                    aria-label={`Placement group ${pg.pg_id} of pool ${pg.pool}`}
                  >
                    {pg.pool}/{pg.pg_id}
                  </Link>
                </td>
                <td className="px-3 py-2 text-[12px] whitespace-nowrap">
                  <Badge kind={risk ? "err" : "warn"}>
                    {s?.state ?? "Unknown"}
                    {risk && s && s.min_spare <= 0 && !SEVERE.includes(s.state) ? ", no spare" : ""}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-[12px] text-text-2 text-right tabular-nums whitespace-nowrap">
                  {plural(s?.recovery?.remaining ?? 0, "object")}, {bytes(s?.recovery?.bytes_remaining ?? 0)}
                </td>
                <td className="px-3 py-2 text-[12px] text-text-2 text-right tabular-nums">
                  {count(s?.shards_missing ?? 0)}
                </td>
                <td className="px-3 py-2 text-[12px] text-muted text-right tabular-nums whitespace-nowrap">
                  {s?.since ? duration(s.since, now) : "—"}
                </td>
              </tr>
            );
          })}
          {more > 0 && (
            <tr className="border-t border-border">
              <td colSpan={5} className="px-3 py-2 h-9 text-[12px] text-muted">
                + {count(more)} more, on each pool's page
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function DrainRow({ d, name, now }: { d: DrainStatus; name: string; now: number }) {
  const initial = Math.max(d.initial_shards, d.shards_remaining);
  const moved = Math.max(0, initial - d.shards_remaining);
  const pctDone = initial > 0 ? Math.round((moved / initial) * 100) : 100;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3 text-[12px]">
        <span className="font-mono text-text">{name}</span>
        <span className="text-muted tabular-nums whitespace-nowrap">
          {count(moved)} of {plural(initial, "shard")} moved · {count(d.shards_remaining)} left
        </span>
      </div>
      <Progress done={moved} total={initial} label={`Drain of ${name}`} />
      <div className="flex justify-between gap-3 text-[11px] text-muted">
        <span>{pctDone}% done</span>
        {d.updated_at > 0 && <span>checked {ago(d.updated_at, now)}</span>}
      </div>
      {d.last_error && <p className="text-[11px] text-err break-words">Last sweep failed: {d.last_error}</p>}
    </div>
  );
}

function RebalanceLine({ r, now }: { r: RebalanceStatus | null; now: number }) {
  if (!r) return <span className="text-muted">Status unavailable</span>;
  return (
    <>
      {r.paused ? (
        <Badge kind="warn">Paused</Badge>
      ) : r.started ? (
        <Badge kind="ok">Running</Badge>
      ) : (
        <Badge>Not started</Badge>
      )}
      <span className="text-muted">
        {r.last_sweep_at ? `last sweep ${ago(r.last_sweep_at, now)}` : "no sweep yet"}
        {(r.pgs_moved_total ?? 0) > 0 && ` · ${plural(r.pgs_moved_total ?? 0, "group")} moved in total`}
      </span>
      {r.last_error && <span className="text-err break-words w-full">Last error: {r.last_error}</span>}
    </>
  );
}

function ScrubLine({ s, now }: { s: ScrubSummary | null; now: number }) {
  if (!s) return <span className="text-muted">Reading…</span>;
  if (s.total === 0) return <span className="text-muted">No groups to scrub</span>;
  const parts: string[] = [];
  if (s.running > 0) parts.push(`${plural(s.running, "group")} scrubbing now`);
  if (s.scrubbed === 0) {
    parts.push("none has completed yet");
  } else {
    parts.push(`last completed ${ago(s.latest, now)}`);
    if (s.scrubbed < s.total) parts.push(`${count(s.total - s.scrubbed)} of ${count(s.total)} groups not scrubbed yet`);
    else parts.push(`oldest ${ago(s.oldest, now)}`);
  }
  const text = parts.join(" · ");
  return (
    <span>
      {text.charAt(0).toUpperCase() + text.slice(1)}
      {s.bad > 0 && (
        <span className="text-err font-medium"> · {plural(s.bad, "bad shard")} found</span>
      )}
    </span>
  );
}
