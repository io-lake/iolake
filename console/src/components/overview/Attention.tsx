import { useState, type ReactNode } from "react";
import { Badge, Button, Chip, type BadgeKind } from "../ui";
import type { DrainStatus, NodeInfo, RebalanceStatus } from "../../api/client";
import type { Protection } from "../../api/protection";
import { driveName, osdName, hostName, rebuildBreakdown } from "./cluster";
import { count, percent, plural } from "./format";
import { LinkButton, Panel } from "./Panel";

/// The OSD's client-write cutoff (`--full-ratio`, `IOLAKE_OSD_FULL_RATIO`):
/// past it a drive refuses client writes and keeps the rest for repair. The
/// console can't read an OSD's setting, so it states the default as one.
const FULL_RATIO_PCT = 95;
const NEAR_FULL_PCT = 75;
const ALMOST_FULL_PCT = 90;

interface Item {
  key: string;
  kind: BadgeKind;
  badge: string;
  title: ReactNode;
  detail: ReactNode;
  action: ReactNode;
}

/// More than this many of one kind fold into one line, so 40 full drives
/// read as one problem rather than a wall of the same sentence.
const FOLD = 3;

function osdLabel(n: NodeInfo, sameHost: boolean) {
  return (
    <>
      <span className="font-mono">{osdName(n)}</span>
      {!sameHost && n.hostname ? (
        <>
          {" "}on <span className="font-mono">{n.hostname}</span>
        </>
      ) : null}
    </>
  );
}

/// What an operator should look at, from the state the console can read:
/// gateway health, placement groups, OSD heartbeats and admin state, drains,
/// drive status and fill, the balancer, and server errors seen since the page
/// opened. Each line says what is wrong and links to where it is fixed.
export default function Attention({
  healthy,
  protection,
  nodes,
  drains,
  rebalance,
  serverErrors,
  onResumeBalancer,
}: {
  healthy: boolean | null;
  protection: Protection | null;
  nodes: NodeInfo[];
  drains: DrainStatus[];
  rebalance: RebalanceStatus | null;
  /// Server errors counted over the live window, and that window in seconds.
  serverErrors: { errors: number; seconds: number } | null;
  onResumeBalancer: () => Promise<void>;
}) {
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState("");
  const items: Item[] = [];
  const oneHost = new Set(nodes.map(hostName)).size <= 1;
  const drives = () => <LinkButton to="/cluster/drives">View drives</LinkButton>;

  if (healthy === false) {
    items.push({
      key: "gateway",
      kind: "err",
      badge: "Gateway",
      title: "The gateway isn't answering health checks",
      detail: "S3 clients may be refused. Check the gateway process and its connection to meta.",
      action: <LinkButton to="/monitoring">Open performance</LinkButton>,
    });
  }

  if (protection && protection.atRisk > 0) {
    items.push({
      key: "pg-risk",
      kind: "err",
      badge: "At risk",
      title: `${plural(protection.atRisk, "placement group")} ${protection.atRisk === 1 ? "has" : "have"} no shard to spare`,
      detail: "One more failure there makes data unreadable.",
      action: <LinkButton to="/cluster/health">View health</LinkButton>,
    });
  }
  if (protection && protection.rebuilding > 0) {
    const working = rebuildBreakdown(protection).working > 0;
    items.push({
      key: "pg-rebuild",
      kind: "warn",
      badge: working ? "Rebuilding" : "Degraded",
      title: `${plural(protection.rebuilding, "placement group")} ${protection.rebuilding === 1 ? "isn't" : "aren't"} clean`,
      detail: (() => {
        const b = rebuildBreakdown(protection);
        const parts: string[] = [];
        if (b.working) parts.push(`Recovery is restoring missing or stale shards in ${count(b.working)}.`);
        if (b.undersized)
          parts.push(`${count(b.undersized)} ${b.undersized === 1 ? "has" : "have"} no usable OSD for a shard; bring one back or add one.`);
        if (b.waitFull) parts.push(`${count(b.waitFull)} wait for room on a full OSD.`);
        parts.push("Data stays readable.");
        return parts.join(" ");
      })(),
      action: <LinkButton to="/cluster/health">{working ? "View repair" : "View health"}</LinkButton>,
    });
  }

  const offline = nodes.filter((n) => !n.online);
  if (offline.length > FOLD) {
    items.push({
      key: "offline",
      kind: "err",
      badge: "Offline",
      title: `${offline.length} OSDs are offline`,
      detail: "The gateway can't reach them. Check their processes and hosts.",
      action: drives(),
    });
  } else {
    for (const n of offline) {
      items.push({
        key: `offline-${n.node_id}`,
        kind: "err",
        badge: "Offline",
        title: <>{osdLabel(n, oneHost)} is offline</>,
        detail: "The gateway can't reach it. Check the process and its host.",
        action: drives(),
      });
    }
  }

  const draining = new Map(drains.map((d) => [d.node_id, d]));
  for (const n of nodes) {
    if (n.admin_state === "out") {
      items.push({
        key: `out-${n.node_id}`,
        kind: "warn",
        badge: "Out",
        title: <>{osdLabel(n, oneHost)} is marked out</>,
        detail: "It takes no new data. Mark it in from Nodes and drives when it's ready.",
        action: drives(),
      });
    } else if (n.admin_state === "draining") {
      const d = draining.get(n.node_id);
      items.push({
        key: `drain-${n.node_id}`,
        kind: "info",
        badge: "Draining",
        title: <>{osdLabel(n, oneHost)} is draining</>,
        detail: d
          ? `${count(d.shards_migrated)} of ${count(d.initial_shards)} shards moved off it.${d.last_error ? ` Last error: ${d.last_error}` : ""}`
          : "Its shards are moving to other OSDs.",
        action: drives(),
      });
    }
  }

  const online = nodes.filter((n) => n.online);
  const sick = online.flatMap((n) =>
    (n.disks ?? []).filter((d) => d.status && d.status !== "healthy").map((d) => ({ n, d })),
  );
  if (sick.length > FOLD) {
    items.push({
      key: "sick",
      kind: "err",
      badge: "Drive",
      title: `${sick.length} drives report a problem`,
      detail: "They don't report healthy. Replace them or take their OSDs out.",
      action: drives(),
    });
  } else {
    for (const { n, d } of sick) {
      items.push({
        key: `sick-${d.disk_id}`,
        kind: "err",
        badge: "Drive",
        title: (
          <>
            A drive on {osdLabel(n, oneHost)} is {d.status}
          </>
        ),
        detail: <span className="font-mono">{driveName(d.path)}</span>,
        action: drives(),
      });
    }
  }

  const full = online
    .flatMap((n) => (n.disks ?? []).map((d) => ({ n, d, pct: percent(d.used_capacity, d.total_capacity) })))
    .filter((x) => x.pct >= NEAR_FULL_PCT)
    .sort((a, b) => b.pct - a.pct);
  const fullDetail = `Client writes to a drive stop at ${FULL_RATIO_PCT}% full by default; the rest is kept for repair. Add drives, or move buckets to another pool.`;
  if (full.length > FOLD) {
    items.push({
      key: "full",
      kind: full[0].pct >= ALMOST_FULL_PCT ? "err" : "warn",
      badge: "Near full",
      title: `${full.length} drives are ${NEAR_FULL_PCT}% full or more, up to ${Math.floor(full[0].pct)}%`,
      detail: fullDetail,
      action: drives(),
    });
  } else {
    for (const { n, d, pct } of full) {
      items.push({
        key: `full-${d.disk_id}`,
        kind: pct >= ALMOST_FULL_PCT ? "err" : "warn",
        badge: "Near full",
        title: (
          <>
            A drive on {osdLabel(n, oneHost)} is {Math.floor(pct)}% full
          </>
        ),
        detail: fullDetail,
        action: drives(),
      });
    }
  }

  if (rebalance?.paused) {
    items.push({
      key: "balancer-paused",
      kind: "warn",
      badge: "Paused",
      title: "The balancer is paused",
      detail: resumeError
        ? `It didn't resume: ${resumeError}`
        : "Data doesn't move to new or emptier drives until you resume it.",
      action: (
        <Button
          size="sm"
          disabled={resuming}
          onClick={() => {
            setResuming(true);
            setResumeError("");
            onResumeBalancer()
              .catch((e: unknown) => setResumeError(e instanceof Error ? e.message : String(e)))
              .finally(() => setResuming(false));
          }}
        >
          {resuming ? "Resuming" : "Resume balancer"}
        </Button>
      ),
    });
  }
  if (rebalance?.last_error) {
    items.push({
      key: "balancer-error",
      kind: "warn",
      badge: "Balancer",
      title: "The balancer's last sweep failed",
      detail: <span className="font-mono break-all">{rebalance.last_error}</span>,
      action: <LinkButton to="/cluster/balancing">Open balancing</LinkButton>,
    });
  }

  if (serverErrors && serverErrors.errors > 0) {
    const mins = Math.max(1, Math.round(serverErrors.seconds / 60));
    items.push({
      key: "5xx",
      kind: "warn",
      badge: "Errors",
      title: `${plural(serverErrors.errors, "S3 request")} failed with a server error in the last ${plural(mins, "minute")}`,
      detail: "These are 5xx responses from this gateway.",
      action: <LinkButton to="/monitoring">Open performance</LinkButton>,
    });
  }

  return (
    <Panel
      title="Needs attention"
      action={items.length ? <Chip mono>{items.length}</Chip> : undefined}
    >
      {items.length === 0 ? (
        <p className="px-4 pt-2 pb-4 text-[12px] text-muted">Nothing needs attention.</p>
      ) : (
        <ul className="flex flex-col pt-2 pb-1.5">
          {items.map((it, i) => (
            <li
              key={it.key}
              className={`flex gap-3 px-4 py-2.5 items-start ${i ? "border-t border-border" : ""}`}
            >
              <Badge kind={it.kind} className="mt-px shrink-0 whitespace-nowrap">
                {it.badge}
              </Badge>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-text break-words">{it.title}</div>
                <div className="text-[12px] text-muted break-words">{it.detail}</div>
              </div>
              <div className="shrink-0">{it.action}</div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
