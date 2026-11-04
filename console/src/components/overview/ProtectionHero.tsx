import type { ReactNode } from "react";
import { AlertTriangle, RotateCw, Shield, ShieldCheck } from "lucide-react";
import type { NodeInfo } from "../../api/client";
import { classify, type Protection } from "../../api/protection";
import { rebuildBreakdown, schemeShort, tolerance, osdName, type Pool } from "./cluster";
import { bytes, count, plural } from "./format";
import { LinkButton, Skeleton } from "./Panel";

const TILE = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  err: "bg-err-soft text-err",
  neutral: "bg-surface-2 text-muted",
} as const;

function IconTile({ kind, children }: { kind: keyof typeof TILE; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={`shrink-0 w-11 h-11 rounded-[10px] inline-flex items-center justify-center ${TILE[kind]}`}
    >
      {children}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[11px] leading-4 font-medium uppercase tracking-[0.06em] text-muted">
        {label}
      </div>
      <div className="text-[15px] font-semibold text-text tabular-nums">{value}</div>
    </div>
  );
}

/// "osd-1f is offline." / "osd-1f and osd-2a are offline." / "3 OSDs are offline."
function offlineSentence(offline: NodeInfo[]): string {
  if (offline.length === 0) return "";
  if (offline.length === 1) return `${osdName(offline[0])} is offline. `;
  if (offline.length === 2) return `${osdName(offline[0])} and ${osdName(offline[1])} are offline. `;
  return `${offline.length} OSDs are offline. `;
}

/// The page's lead: is every object fully protected right now, and if not,
/// what is being done and how far it has got. Everything here comes from
/// what peering last found of each placement group (`useProtection`), the
/// pools' schemes and the OSD list; nothing is estimated.
export default function ProtectionHero({
  protection,
  pools,
  nodes,
}: {
  protection: Protection | null;
  pools: Pool[];
  nodes: NodeInfo[];
}) {
  const shell =
    "bg-surface border border-border rounded-card shadow-card px-5 py-[18px] flex gap-[18px] items-center flex-wrap";

  if (!protection) {
    return (
      <section aria-label="Data protection" aria-busy="true" className={shell}>
        <Skeleton className="w-11 h-11 !rounded-[10px]" />
        <div className="flex-1 min-w-[240px] flex flex-col gap-2">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-4 w-full max-w-[520px]" />
        </div>
        <span className="sr-only">Reading placement groups</span>
      </section>
    );
  }

  const offline = nodes.filter((n) => !n.online);
  const schemes = [...new Set(pools.map(schemeShort))];
  const scheme = schemes.length === 1 ? schemes[0] : schemes.length ? `${schemes.length} schemes` : "—";

  if (protection.level === "unknown") {
    return (
      <section aria-label="Data protection" className={shell}>
        <IconTile kind="neutral">
          <Shield size={22} strokeWidth={1.75} />
        </IconTile>
        <div className="flex-1 basis-[420px] min-w-0">
          <h2 className="font-display text-[18px] leading-6 font-semibold text-text">
            Protection status isn't available
          </h2>
          <p className="mt-1 text-text-2 max-w-[74ch]">
            The placement groups couldn't be read from meta, so the console can't say how well your
            data is protected. It tries again every 30 seconds.
          </p>
        </div>
      </section>
    );
  }

  if (protection.level === "protected") {
    const tol = pools.length ? Math.min(...pools.map(tolerance)) : null;
    const survives =
      tol == null
        ? ""
        : tol === 0
          ? " A pool without parity loses data with any one drive."
          : ` Every object survives the loss of any ${plural(tol, "drive")}.`;
    return (
      <section aria-label="Data protection" className={shell}>
        <IconTile kind="ok">
          <ShieldCheck size={22} strokeWidth={1.75} />
        </IconTile>
        <div className="flex-1 basis-[420px] min-w-0">
          <h2 className="font-display text-[18px] leading-6 font-semibold text-text">
            All data is fully protected
          </h2>
          <p className="mt-1 text-text-2 max-w-[70ch]">
            {count(protection.clean)} of {count(protection.total)} placement groups are clean.
            {survives}
          </p>
        </div>
        <div className="flex gap-7 flex-wrap">
          <Fact label="Protection" value={scheme} />
          <Fact label="Placement groups" value={count(protection.total)} />
          <Fact label="Repair queue" value={count(protection.objectsRemaining)} />
        </div>
      </section>
    );
  }

  if (protection.level === "rebuilding") {
    const { working, undersized, waitFull } = rebuildBreakdown(protection);
    // Recovery counts the objects it has made whole in a group since it was
    // last clean, and what was left at its last count. Their ratio is a true
    // progress figure only once every group it is working on has been
    // counted; before that the bar would claim progress nobody measured.
    const active = protection.notClean.filter(
      (pg) => classify(pg) === "rebuilding" && !["Undersized", "WaitTooFull"].includes(pg.state?.state ?? ""),
    );
    const counted =
      active.length > 0 &&
      active.every((pg) => (pg.state?.recovery.recovered ?? 0) + (pg.state?.recovery.remaining ?? 0) > 0);
    const done = active.reduce((a, pg) => a + (pg.state?.recovery.recovered ?? 0), 0);
    const left = protection.objectsRemaining;
    const pct = counted && done + left > 0 ? Math.floor((done / (done + left)) * 100) : null;
    const leaving = nodes.filter((n) => n.online && (n.admin_state === "out" || n.admin_state === "draining"));
    const are = (n: number) => (n === 1 ? "is" : "are");
    return (
      <section aria-label="Data protection" className={shell}>
        <IconTile kind="warn">
          <RotateCw size={22} strokeWidth={1.75} />
        </IconTile>
        <div className="flex-1 basis-[420px] min-w-0 flex flex-col gap-2">
          <h2 className="font-display text-[18px] leading-6 font-semibold text-text">
            {undersized > 0 && working === 0
              ? `${plural(undersized, "placement group")} ${undersized === 1 ? "is" : "are"} short of an OSD`
              : `Rebuilding ${plural(working + waitFull, "placement group")}`}
          </h2>
          <p className="text-text-2 max-w-[78ch]">
            {offlineSentence(offline)}
            {leaving.map((n) => `${osdName(n)} is ${n.admin_state === "out" ? "marked out" : "draining"}. `)}
            {working > 0 &&
              `${count(working)} of ${count(protection.total)} placement groups ${are(working)} missing a shard or hold a stale one, and recovery is putting it back. `}
            {undersized > 0 &&
              `${count(undersized)}${working > 0 ? "" : ` of ${count(protection.total)}`} ${undersized === 1 ? "has" : "have"} a shard position with no usable OSD, so ${undersized === 1 ? "it runs" : "they run"} with less protection until an OSD comes back or is added. `}
            {waitFull > 0 &&
              `${count(waitFull)} ${are(waitFull)} waiting for room: an OSD ${waitFull === 1 ? "it" : "they"} would rebuild onto is too full. `}
            Every object can still be read.
          </p>
          {pct != null ? (
            <div className="flex items-center gap-3 max-w-[560px] flex-wrap">
              <div
                className="flex-1 min-w-[160px] h-1.5 rounded-full bg-surface-2 border border-border overflow-hidden"
                role="progressbar"
                aria-label="Rebuild progress"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="h-full bg-warn-dot" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[12px] text-text-2 tabular-nums whitespace-nowrap">
                {pct}% · {count(done)} of {count(done + left)} objects
                {protection.bytesRemaining > 0 && ` · ${bytes(protection.bytesRemaining)} left`}
              </span>
            </div>
          ) : left > 0 ? (
            <p className="text-[12px] text-text-2 tabular-nums">
              {plural(left, "object")} left to rebuild
              {protection.bytesRemaining > 0 && `, ${bytes(protection.bytesRemaining)}`}
            </p>
          ) : null}
        </div>
        <LinkButton to="/cluster/health" size="md">
          {working > 0 ? "View repair" : "View health"}
        </LinkButton>
      </section>
    );
  }

  // At risk: no spare left in some group, or a group that can't serve.
  const atRisk = protection.notClean.filter((pg) => classify(pg) === "atRisk");
  const down = atRisk.filter((pg) => pg.state && ["Down", "Incomplete"].includes(pg.state.state));
  const unreadable = atRisk.some((pg) => (pg.state?.min_spare ?? 0) < 0) || down.length > 0;
  const unfound = atRisk.reduce((a, pg) => a + (pg.state?.objects_unfound ?? 0), 0);
  return (
    <section aria-label="Data protection" className={shell}>
      <IconTile kind="err">
        <AlertTriangle size={22} strokeWidth={1.75} />
      </IconTile>
      <div className="flex-1 basis-[420px] min-w-0">
        <h2 className="font-display text-[18px] leading-6 font-semibold text-text">
          {down.length > 0
            ? `${plural(down.length, "placement group")} can't serve requests`
            : `${plural(atRisk.length, "placement group")} can't lose another drive`}
        </h2>
        <p className="mt-1 text-text-2 max-w-[74ch]">
          {offlineSentence(offline)}
          {unreadable
            ? unfound > 0
              ? `${unfound === 1 ? "1 object has" : `${count(unfound)} objects have`} fewer shards than a read needs. `
              : "Some objects can't be read right now. "
            : "Their data is still readable, but one more drive failure would make some of it unreadable. "}
          {offline.length > 0 ? "Bring the offline OSDs back or replace their drives." : "See which data is affected."}
        </p>
      </div>
      <LinkButton to="/cluster/health" variant="primary" size="md">
        See affected data
      </LinkButton>
    </section>
  );
}
