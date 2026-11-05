import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import { Button, CapacityBar, ChartCard, LegendDot, Tabs } from "../components/ui";
import {
  cluster,
  drain as drainApi,
  nodes as nodesApi,
  rebalance as rebalanceApi,
  request,
  type DrainStatus,
  type NodeInfo,
  type RebalanceStatus,
} from "../api/client";
import {
  LIVE_INTERVAL_MS,
  MAX_LIVE_POINTS,
  QUERIES,
  RANGES,
  capabilities,
  queryInstant,
  queryRange,
  withRate,
  type MetricsCapabilities,
  type Series,
} from "../api/metrics";
import { groupSum, parse, quantile, rate, total, type Scrape } from "../api/exposition";
import { useProtection } from "../api/protection";
import ProtectionHero from "../components/overview/ProtectionHero";
import Attention from "../components/overview/Attention";
import CapacityPanel from "../components/overview/CapacityPanel";
import TrendChart, { Sparkline, type TrendRow } from "../components/overview/TrendChart";
import { Skeleton } from "../components/overview/Panel";
import { hostName, schemeLong, type Pool, type Usage } from "../components/overview/cluster";
import { bytes, bytesShort, count, ms, percent, perSecond, plural } from "../components/overview/format";

// There is no "Recent activity" panel: nothing records an audit or event
// log the console can read (bucket creation, key rotation, scrubs, balancer
// moves), and a feed pieced together from whatever this page happens to know
// would read as a history it isn't.

const REQUESTS = "iolake_s3_requests_total";
const READ_BYTES = "iolake_s3_response_bytes_total";
const WRITE_BYTES = "iolake_s3_request_bytes_total";
const DURATION = "iolake_s3_request_duration_seconds";

const PROM = {
  read: `sum(rate(${READ_BYTES}[$RATE]))`,
  write: `sum(rate(${WRITE_BYTES}[$RATE]))`,
  p50: QUERIES.latencyQuantile(0.5),
  p99: QUERIES.latencyQuantile(0.99),
};

const HISTORY_RANGES = RANGES.filter((r) => r.needsPrometheus);

/// Keep only what this page reads from a scrape: the full text is thousands
/// of samples, and a window of them is held in state.
function slim(text: string, t: number): Scrape {
  const keep = [REQUESTS, READ_BYTES, WRITE_BYTES, `${DURATION}_bucket`];
  return { t, samples: parse(text).filter((s) => keep.includes(s.name)) };
}

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

type Latency = { p50: number; p99: number } | "none" | "inconsistent";

/// p50 and p99 of the requests between two scrapes, or why there are none.
/// A histogram whose buckets don't rise to its total can't give a true
/// percentile, so it is reported as such rather than computed anyway.
function liveLatency(cur: Scrape, prev: Scrape): Latency {
  const bucket = `${DURATION}_bucket`;
  const a = groupSum(cur.samples, bucket, "le");
  const b = groupSum(prev.samples, bucket, "le");
  const inc = Object.keys(a)
    .map((le) => [le === "+Inf" ? Infinity : Number.parseFloat(le), a[le] - (b[le] ?? 0)] as const)
    .sort((x, y) => x[0] - y[0]);
  const all = inc.at(-1);
  if (!all || all[0] !== Infinity || all[1] <= 0) return "none";
  for (let i = 1; i < inc.length; i++) {
    if (inc[i][1] < inc[i - 1][1]) return "inconsistent";
  }
  const p50 = quantile(cur, prev, DURATION, 0.5).value;
  const p99 = quantile(cur, prev, DURATION, 0.99).value;
  return p50 == null || p99 == null ? "none" : { p50, p99 };
}

interface LivePoint {
  t: number;
  req: number;
  read: number;
  write: number;
  latency: Latency;
}

/// Join range series by timestamp into chart rows.
function joinSeries(named: Record<string, Series[]>, scale = 1): TrendRow[] {
  const byT = new Map<number, TrendRow>();
  for (const [key, list] of Object.entries(named)) {
    for (const pt of list[0]?.points ?? []) {
      if (!Number.isFinite(pt.v)) continue;
      const row = byT.get(pt.t) ?? { t: pt.t };
      row[key] = pt.v * scale;
      byT.set(pt.t, row);
    }
  }
  return [...byT.values()].sort((x, y) => x.t - y.t);
}

function Tile({
  label,
  loading,
  value,
  aside,
  children,
  sub,
}: {
  label: string;
  loading?: boolean;
  value: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="bg-surface border border-border rounded-card shadow-card px-4 py-3.5 flex flex-col gap-1.5 min-w-0">
      <div className="font-mono text-[11px] leading-4 font-medium uppercase tracking-[0.06em] text-muted">
        {label}
      </div>
      {loading ? (
        <>
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-3.5 w-36" />
        </>
      ) : (
        <>
          <div className="flex items-end justify-between gap-2 min-w-0">
            <div className="flex items-baseline gap-1.5 min-w-0">{value}</div>
            {aside}
          </div>
          {children}
          {sub && <div className="text-[11.5px] text-muted">{sub}</div>}
        </>
      )}
    </div>
  );
}

function Big({ children }: { children: ReactNode }) {
  return (
    <span className="font-display text-[24px] leading-7 font-semibold text-text tabular-nums whitespace-nowrap">
      {children}
    </span>
  );
}

function ChartNote({ children }: { children: ReactNode }) {
  return (
    <div className="h-[200px] flex items-center justify-center text-center px-6">
      <p className="text-[12px] text-muted max-w-sm">{children}</p>
    </div>
  );
}

export default function Dashboard() {
  /// null until the node list answers; false for a tenant's console, which
  /// may not read cluster state.
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [nodeList, setNodeList] = useState<NodeInfo[] | null>(null);
  const [pools, setPools] = useState<Pool[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [balancer, setBalancer] = useState<RebalanceStatus | null>(null);
  const [drains, setDrains] = useState<DrainStatus[]>([]);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [caps, setCaps] = useState<MetricsCapabilities | null>(null);
  const [range, setRange] = useState("24h");
  const [history, setHistory] = useState<{ tput: TrendRow[]; lat: TrendRow[] } | null>(null);
  const [promNow, setPromNow] = useState<{ p50?: number; p99?: number }>({});
  const [scrapes, setScrapes] = useState<Scrape[]>([]);

  const protection = useProtection(admin === true);

  const load = useCallback(async () => {
    cluster.health().then(setHealthy).catch(() => setHealthy(false));
    fetch("/_admin/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then(setUsage)
      .catch(() => setUsage(null));
    try {
      const d = await nodesApi.list();
      setNodeList(d.nodes ?? []);
      setAdmin(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.startsWith("403") || msg.startsWith("401")) {
        setAdmin(false);
        return;
      }
      setAdmin(true);
      setNodeList([]);
    }
    request<Pool[] | { pools: Pool[] }>("GET", "/_admin/pools")
      .then((d) => setPools(Array.isArray(d) ? d : (d.pools ?? [])))
      .catch(() => setPools([]));
    rebalanceApi.status().then(setBalancer).catch(() => setBalancer(null));
    drainApi
      .status()
      .then((d) => setDrains(d.drains ?? []))
      .catch(() => setDrains([]));
  }, []);

  const sample = useCallback(async () => {
    try {
      const s = slim(await cluster.metrics(), Date.now());
      setScrapes((list) => [...list, s].slice(-(MAX_LIVE_POINTS + 1)));
    } catch {
      // A missed scrape is a gap in the live window, not a page failure.
    }
  }, []);

  const loadHistory = useCallback(async (key: string) => {
    const r = HISTORY_RANGES.find((x) => x.key === key) ?? HISTORY_RANGES[0];
    const q = (expr: string) => queryRange(withRate(expr, r.seconds), r.seconds).catch(() => [] as Series[]);
    const [read, write, p50, p99] = await Promise.all([q(PROM.read), q(PROM.write), q(PROM.p50), q(PROM.p99)]);
    setHistory({ tput: joinSeries({ read, write }), lat: joinSeries({ p99, p50 }, 1000) });
  }, []);

  const loadPromNow = useCallback(async () => {
    const one = (expr: string) =>
      queryInstant(withRate(expr, 300))
        .then((s) => s[0]?.points.at(-1)?.v)
        .catch(() => undefined);
    const [p50, p99] = await Promise.all([one(PROM.p50), one(PROM.p99)]);
    setPromNow({
      p50: p50 != null && Number.isFinite(p50) ? p50 : undefined,
      p99: p99 != null && Number.isFinite(p99) ? p99 : undefined,
    });
  }, []);

  // These start async work and set state only after their awaits; the rule
  // can't see past the call.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (admin !== true) return;
    capabilities()
      .then(setCaps)
      .catch(() => setCaps(null));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void sample();
    const t = setInterval(() => void sample(), LIVE_INTERVAL_MS);
    return () => clearInterval(t);
  }, [admin, sample]);

  useEffect(() => {
    if (!caps?.prometheus) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadHistory(range);
    void loadPromNow();
    const t = setInterval(() => {
      void loadHistory(range);
      void loadPromNow();
    }, 60_000);
    return () => clearInterval(t);
  }, [caps, range, loadHistory, loadPromNow]);

  const live = useMemo<LivePoint[]>(() => {
    const out: LivePoint[] = [];
    for (let i = 1; i < scrapes.length; i++) {
      const cur = scrapes[i];
      const prev = scrapes[i - 1];
      out.push({
        t: cur.t,
        req: sum(rate(cur, prev, REQUESTS, "operation")),
        read: sum(rate(cur, prev, READ_BYTES)),
        write: sum(rate(cur, prev, WRITE_BYTES)),
        latency: liveLatency(cur, prev),
      });
    }
    return out;
  }, [scrapes]);

  // What the live window saw in total: the operation mix and server errors.
  const seen = useMemo(() => {
    if (scrapes.length < 2) return null;
    const first = scrapes[0];
    const last = scrapes[scrapes.length - 1];
    const a = groupSum(last.samples, REQUESTS, "operation");
    const b = groupSum(first.samples, REQUESTS, "operation");
    const ops = Object.entries(a)
      .map(([op, v]) => [op, Math.max(0, v - (b[op] ?? 0))] as const)
      .filter(([, v]) => v > 0)
      .sort((x, y) => y[1] - x[1]);
    const errNow = total(last.samples, REQUESTS, { status: "server_error" }) ?? 0;
    const errThen = total(first.samples, REQUESTS, { status: "server_error" }) ?? 0;
    return {
      seconds: (last.t - first.t) / 1000,
      ops,
      requests: ops.reduce((x, [, v]) => x + v, 0),
      errors: Math.max(0, errNow - errThen),
    };
  }, [scrapes]);

  const resumeBalancer = useCallback(async () => {
    await rebalanceApi.resume();
    setBalancer(await rebalanceApi.status());
  }, []);

  if (admin === false) return <TenantOverview usage={usage} />;

  const nodes = nodeList ?? [];
  const loading = nodeList === null;
  const disks = nodes.flatMap((n) => n.disks ?? []);
  const rawTotal = disks.reduce((a, d) => a + (d.total_capacity ?? 0), 0);
  const rawUsed = disks.reduce((a, d) => a + (d.used_capacity ?? 0), 0);
  const up = nodes.filter((n) => n.online);
  const hosts = new Set(up.map(hostName)).size;
  const unhealthy = up.reduce((a, n) => a + (n.disks ?? []).filter((d) => d.status !== "healthy").length, 0);
  const marked = (st: string) => nodes.filter((n) => n.admin_state === st).length;
  const schemes = [...new Set(pools.map(schemeLong))];

  const description = loading
    ? "Reading the cluster"
    : nodes.length === 0
      ? "No OSDs have registered yet"
      : [
          plural(hosts, "host"),
          plural(nodes.length, "OSD"),
          plural(disks.length, "drive"),
          `${bytes(rawTotal)} raw`,
          schemes.length === 1 ? schemes[0] : schemes.length > 1 ? plural(pools.length, "pool") : null,
        ]
          .filter(Boolean)
          .join(" · ");

  const now = live.at(-1);
  const prom = caps?.prometheus === true;
  const liveLat = live.map((p) => p.latency);
  const lastLat = [...liveLat].reverse().find((l) => typeof l === "object");
  const latBroken = liveLat.some((l) => l === "inconsistent");
  const p99 = prom ? promNow.p99 : typeof lastLat === "object" ? lastLat.p99 : undefined;
  const p50 = prom ? promNow.p50 : typeof lastLat === "object" ? lastLat.p50 : undefined;

  let mix = "Measuring";
  if (seen && seen.requests === 0) {
    mix = `No requests in the last ${plural(Math.max(1, Math.round(seen.seconds)), "second")}`;
  } else if (seen) {
    const share = (v: number) => `${Math.round((v / seen.requests) * 100)}%`;
    const parts = seen.ops.slice(0, 2).map(([op, v]) => `${op} ${share(v)}`);
    const rest = seen.ops.slice(2).reduce((a, [, v]) => a + v, 0);
    if (rest > 0) parts.push(`other ${share(rest)}`);
    mix = parts.join(" · ");
  }

  const liveRows = (pick: (p: LivePoint) => Record<string, number | undefined>): TrendRow[] =>
    live.map((p) => ({ t: p.t, ...pick(p) }));
  const tputRows = prom ? (history?.tput ?? []) : liveRows((p) => ({ read: p.read, write: p.write }));
  const latRows = prom
    ? (history?.lat ?? [])
    : liveRows((p) =>
        typeof p.latency === "object" ? { p99: p.latency.p99 * 1000, p50: p.latency.p50 * 1000 } : {},
      );
  const latPoints = latRows.filter((r) => r.p99 != null);
  const lastT = tputRows.at(-1);
  const lastL = latPoints.at(-1);
  const windowText = prom
    ? `last ${HISTORY_RANGES.find((r) => r.key === range)?.label ?? range}`
    : "live, since this page opened";

  return (
    <div className="px-8 py-6 flex flex-col gap-4">
      <PageHeader
        title="Overview"
        description={description}
        action={
          <>
            {prom && (
              <div role="group" aria-label="Time range">
                <Tabs
                  items={HISTORY_RANGES.map((r) => ({ key: r.key, label: r.label }))}
                  value={range}
                  onChange={setRange}
                />
              </div>
            )}
            <Button
              variant="secondary"
              icon={<RefreshCw size={13} />}
              onClick={() => {
                void load();
                if (prom) {
                  void loadHistory(range);
                  void loadPromNow();
                }
              }}
            >
              Refresh
            </Button>
          </>
        }
      />

      <ProtectionHero protection={protection} pools={pools} nodes={nodes} />

      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <Tile
          label="Capacity used"
          loading={loading}
          value={
            <>
              <Big>{bytes(rawUsed)}</Big>
              <span className="text-muted tabular-nums whitespace-nowrap">of {bytes(rawTotal)}</span>
            </>
          }
          sub={
            rawTotal > 0
              ? `${percent(rawUsed, rawTotal).toFixed(1)}% of raw · ${bytes(rawTotal - rawUsed)} free`
              : "No drives reporting"
          }
        >
          <CapacityBar used={rawUsed} total={rawTotal} />
        </Tile>

        <Tile
          label="S3 requests"
          loading={scrapes.length === 0}
          value={<Big>{now ? `${perSecond(now.req)}/s` : "—"}</Big>}
          aside={
            live.length > 1 ? (
              <Sparkline values={live.map((p) => p.req)} label="Requests per second since this page opened" />
            ) : undefined
          }
          sub={mix}
        />

        <Tile
          label="p99 latency"
          loading={!prom && scrapes.length === 0}
          value={<Big>{p99 != null ? ms(p99) : "—"}</Big>}
          aside={
            !prom && latPoints.length > 1 ? (
              <Sparkline values={latPoints.map((r) => Number(r.p99))} label="p99 latency since this page opened" />
            ) : undefined
          }
          sub={
            p50 != null
              ? `p50 ${ms(p50)} · all operations`
              : latBroken && !prom
                ? "The gateway's latency histogram doesn't add up"
                : "No requests to measure yet"
          }
        />

        <Tile
          label="Objects"
          loading={usage === null && loading}
          value={<Big>{usage?.cluster ? count(usage.cluster.objects) : "—"}</Big>}
          sub={
            usage?.cluster
              ? `${bytes(usage.cluster.logical_bytes)} in ${plural(usage.cluster.buckets, "bucket")}`
              : "Usage hasn't been gathered yet"
          }
        />

        <Tile
          label="OSDs up"
          loading={loading}
          value={
            <>
              <Big>{count(up.length)}</Big>
              <span className="text-muted tabular-nums whitespace-nowrap">of {count(nodes.length)}</span>
            </>
          }
          sub={[
            plural(disks.length, "drive"),
            unhealthy ? `${unhealthy} not healthy` : disks.length ? "all healthy" : null,
            marked("out") ? `${marked("out")} out` : null,
            marked("draining") ? `${marked("draining")} draining` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
      </div>

      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(440px,100%),1fr))]">
        <ChartCard
          title="Throughput"
          subtitle={`bytes per second, all pools · ${windowText}`}
          className="shadow-card min-w-0"
          legend={
            <div className="flex gap-3.5 flex-wrap">
              <LegendDot index={0} label={`Read${lastT?.read != null ? ` ${bytes(Number(lastT.read))}/s` : ""}`} />
              <LegendDot index={1} label={`Write${lastT?.write != null ? ` ${bytes(Number(lastT.write))}/s` : ""}`} />
            </div>
          }
        >
          {tputRows.length > 1 ? (
            <TrendChart
              rows={tputRows}
              series={[
                { key: "read", label: "Read", color: 0 },
                { key: "write", label: "Write", color: 1 },
              ]}
              axisFormat={bytesShort}
              base={1024}
              valueFormat={(v) => `${bytes(v)}/s`}
              label={`S3 throughput, ${windowText}. Now ${bytes(Number(lastT?.read ?? 0))}/s read and ${bytes(Number(lastT?.write ?? 0))}/s written.`}
            />
          ) : prom && history ? (
            <ChartNote>Prometheus has no samples for this range yet.</ChartNote>
          ) : (
            <ChartNote>
              Measuring. A rate needs two scrapes of the gateway's counters, {LIVE_INTERVAL_MS / 1000} seconds
              apart.
            </ChartNote>
          )}
        </ChartCard>

        <ChartCard
          title="Request latency"
          subtitle={`milliseconds, all S3 operations · ${windowText}`}
          className="shadow-card min-w-0"
          legend={
            latPoints.length ? (
              <div className="flex gap-3.5 flex-wrap">
                <LegendDot index={0} label={`p99${lastL?.p99 != null ? ` ${Math.round(Number(lastL.p99))}` : ""}`} />
                <LegendDot index={2} label={`p50${lastL?.p50 != null ? ` ${Math.round(Number(lastL.p50))}` : ""}`} />
              </div>
            ) : undefined
          }
        >
          {latPoints.length > 1 ? (
            <TrendChart
              rows={latRows}
              series={[
                { key: "p99", label: "p99", color: 0 },
                { key: "p50", label: "p50", color: 2 },
              ]}
              axisFormat={(v) => `${Math.round(v)}`}
              valueFormat={(v) => `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`}
              label={`S3 request latency, ${windowText}. p99 now ${Math.round(Number(lastL?.p99 ?? 0))} ms, p50 ${Math.round(Number(lastL?.p50 ?? 0))} ms.`}
            />
          ) : prom ? (
            <ChartNote>Prometheus has no latency samples for this range yet.</ChartNote>
          ) : latBroken ? (
            <ChartNote>
              The gateway's request-duration histogram has buckets that count more requests than its total, so
              no percentile computed from it would be right.
            </ChartNote>
          ) : (
            <ChartNote>
              No S3 requests to measure since this page opened. Percentiles appear as requests arrive; for a
              history, point the gateway at Prometheus.
            </ChartNote>
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 items-start grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))]">
        <Attention
          healthy={healthy}
          protection={protection}
          nodes={nodes}
          drains={drains}
          rebalance={balancer}
          serverErrors={seen ? { errors: seen.errors, seconds: seen.seconds } : null}
          onResumeBalancer={resumeBalancer}
        />
        <CapacityPanel nodes={nodes} />
      </div>

      {pools.length === 0 && !loading && (
        <p className="text-[12px] text-muted">
          No pools are defined.{" "}
          <Link to="/cluster/pools" className="text-accent hover:underline">
            Create one
          </Link>
        </p>
      )}
    </div>
  );
}

/// A tenant's console sees its own storage only: cluster state, other
/// tenants' traffic and raw capacity aren't theirs to read.
function TenantOverview({ usage }: { usage: Usage | null }) {
  const t = usage?.tenants[0];
  return (
    <div className="px-8 py-6 flex flex-col gap-4">
      <PageHeader
        title="Overview"
        description={t ? `Storage in tenant ${t.tenant}` : "Your tenant's storage"}
      />
      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <Tile label="Objects" loading={usage === null} value={<Big>{t ? count(t.objects) : "—"}</Big>} />
        <Tile
          label="Stored"
          loading={usage === null}
          value={<Big>{t ? bytes(t.logical_bytes) : "—"}</Big>}
          sub={t && t.quota_bytes > 0 ? `of a ${bytes(t.quota_bytes)} quota` : "No quota set"}
        >
          {t && t.quota_bytes > 0 ? <CapacityBar used={t.logical_bytes} total={t.quota_bytes} /> : null}
        </Tile>
        <Tile
          label="Buckets"
          loading={usage === null}
          value={<Big>{t ? count(t.buckets) : "—"}</Big>}
          sub={
            <Link to="/buckets" className="text-accent hover:underline">
              View buckets
            </Link>
          }
        />
      </div>
    </div>
  );
}
