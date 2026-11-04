import { useCallback, useEffect, useRef, useState } from "react";
import {
  drain as drainApi,
  nodes as nodesApi,
  placementGroups,
  rebalance as rebalanceApi,
  request,
  type DiskInfo,
  type DrainStatus,
  type NodeInfo,
  type OsdAdminState,
  type RebalanceStatus,
} from "../../api/client";

/// What the health page reads besides protection: every OSD (the nodes
/// listing, which includes OSDs marked out), where each sits (cluster-info's
/// failure domains, from meta, so a down OSD still has a host and a rack),
/// drains in flight, the rebalancer, and the pools' layouts.

export interface PoolInfo {
  name: string;
  ec_type: number;
  ec_k: number;
  ec_m: number;
  ec_local_parity: number;
  ec_global_parity: number;
  replication_count: number;
  failure_domain: string;
  pg_count?: number;
}

interface FailureDomain {
  region: string;
  zone: string;
  datacenter: string;
  rack: string;
  host: string;
}

interface ClusterInfo {
  osds: { node_id: string; address: string; failure_domain: FailureDomain }[];
}

/// What a drive tile shows, most important first: an OSD marked out is out of
/// placement whatever else is true of it; one that doesn't answer is down; a
/// draining one is moving its shards off; a disk reporting anything but
/// healthy is unhealthy.
export type DriveState = "out" | "down" | "draining" | "unhealthy" | "up";

export interface Drive {
  id: string;
  name: string;
  /// The few hex digits a 30px tile has room for.
  short: string;
  host: string;
  rack: string;
  address: string;
  online: boolean;
  admin: OsdAdminState;
  state: DriveState;
  used: number;
  total: number;
  shards: number;
  disks: DiskInfo[];
  version: string;
  uptime: number;
  /// Capacity is what it reported the last time it answered (it is down now).
  stale: boolean;
  drain?: DrainStatus;
}

export interface HostGroup {
  name: string;
  rack: string;
  drives: Drive[];
  up: number;
  used: number;
  total: number;
}

export interface RackGroup {
  name: string;
  hosts: HostGroup[];
  drives: number;
  used: number;
  total: number;
}

export interface ClusterSnapshot {
  drives: Drive[];
  hosts: HostGroup[];
  racks: RackGroup[];
  /// False when every OSD sits in the default (unset) rack.
  racksConfigured: boolean;
  drains: DrainStatus[];
  rebalance: RebalanceStatus | null;
  pools: PoolInfo[];
  /// Set when the OSD listing can't be read (meta unreachable).
  error: string | null;
  loadedAt: number;
}

/// The rack an OSD reports when none was set in its config.
const UNSET_RACK = new Set(["", "default", "(none)"]);

export function driveName(id: string, name?: string): string {
  return name || `osd-${id.slice(0, 8)}`;
}

function driveState(n: NodeInfo): DriveState {
  const admin = n.admin_state ?? "in";
  if (admin === "out") return "out";
  if (!n.online) return "down";
  if (admin === "draining") return "draining";
  if ((n.disks ?? []).some((d) => d.status && d.status !== "healthy")) return "unhealthy";
  return "up";
}

function build(
  list: NodeInfo[],
  info: ClusterInfo | null,
  drains: DrainStatus[],
  known: Map<string, NodeInfo>,
): Pick<ClusterSnapshot, "drives" | "hosts" | "racks" | "racksConfigured"> {
  const fd = new Map((info?.osds ?? []).map((o) => [o.node_id, o.failure_domain]));
  const drainBy = new Map(drains.map((d) => [d.node_id, d]));

  const drives: Drive[] = list.map((n) => {
    // A down OSD answers with nothing but its id and address; fall back to
    // what it said the last time it answered, and to meta's failure domain.
    const last = n.online ? n : (known.get(n.node_id) ?? n);
    const where = fd.get(n.node_id);
    const host =
      last.kubernetes_node || last.hostname || where?.host || driveName(n.node_id, last.node_name);
    return {
      id: n.node_id,
      name: driveName(n.node_id, last.node_name),
      short: n.node_id.slice(0, 4),
      host,
      rack: where?.rack ?? "",
      address: n.address,
      online: n.online,
      admin: n.admin_state ?? "in",
      state: driveState(n),
      used: last.used_capacity ?? 0,
      total: last.total_capacity ?? 0,
      shards: last.shard_count ?? 0,
      disks: last.disks ?? [],
      version: last.version ?? "",
      uptime: n.online ? n.uptime_seconds : 0,
      stale: !n.online && last !== n,
      drain: drainBy.get(n.node_id),
    };
  });
  drives.sort((a, b) => a.name.localeCompare(b.name));

  const byHost = new Map<string, Drive[]>();
  for (const d of drives) {
    if (!byHost.has(d.host)) byHost.set(d.host, []);
    byHost.get(d.host)!.push(d);
  }
  const hosts: HostGroup[] = [...byHost]
    .map(([name, ds]) => {
      // An OSD marked out drops out of cluster-info; its host's other drives
      // still say which rack the host is in.
      const rack = ds.find((d) => d.rack)?.rack ?? "";
      for (const d of ds) if (!d.rack) d.rack = rack;
      return {
        name,
        rack,
        drives: ds,
        up: ds.filter((d) => d.online).length,
        used: ds.reduce((s, d) => s + d.used, 0),
        total: ds.reduce((s, d) => s + d.total, 0),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const racksConfigured = hosts.some((h) => !UNSET_RACK.has(h.rack));
  const byRack = new Map<string, HostGroup[]>();
  for (const h of hosts) {
    const key = racksConfigured ? h.rack || "(no rack)" : "";
    if (!byRack.has(key)) byRack.set(key, []);
    byRack.get(key)!.push(h);
  }
  const racks: RackGroup[] = [...byRack]
    .map(([name, hs]) => ({
      name,
      hosts: hs,
      drives: hs.reduce((s, h) => s + h.drives.length, 0),
      used: hs.reduce((s, h) => s + h.used, 0),
      total: hs.reduce((s, h) => s + h.total, 0),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { drives, hosts, racks, racksConfigured };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/// The cluster's OSDs, drains and rebalancer, refreshed every `everyMs`.
/// `null` until the first answer.
export function useClusterSnapshot(everyMs = 10_000) {
  const [snap, setSnap] = useState<ClusterSnapshot | null>(null);
  const known = useRef(new Map<string, NodeInfo>());

  const load = useCallback(async () => {
    const [n, ci, dr, rb, pl] = await Promise.allSettled([
      nodesApi.list(),
      request<ClusterInfo>("GET", "/_admin/cluster-info"),
      drainApi.status(),
      rebalanceApi.status(),
      request<PoolInfo[] | { pools: PoolInfo[] }>("GET", "/_admin/pools"),
    ]);
    const list = n.status === "fulfilled" ? (n.value.nodes ?? []) : [];
    for (const node of list) if (node.online) known.current.set(node.node_id, node);
    const drains = dr.status === "fulfilled" ? (dr.value.drains ?? []) : [];
    const pools =
      pl.status === "fulfilled"
        ? Array.isArray(pl.value)
          ? pl.value
          : (pl.value.pools ?? [])
        : [];
    setSnap({
      ...build(list, ci.status === "fulfilled" ? ci.value : null, drains, known.current),
      drains,
      rebalance: rb.status === "fulfilled" ? rb.value : null,
      pools,
      error: n.status === "rejected" ? message(n.reason) : null,
      loadedAt: Date.now(),
    });
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), everyMs);
    return () => clearInterval(t);
  }, [load, everyMs]);

  return { snap, reload: load };
}

export interface ScrubSummary {
  /// Groups whose scrub has completed at least once.
  scrubbed: number;
  total: number;
  running: number;
  /// Unix seconds: the most recent completion, and the oldest last completion
  /// among the groups that have one.
  latest: number;
  oldest: number;
  /// Bad shards the groups' last scrubs found.
  bad: number;
}

/// When scrubs last completed, across every pool's groups. Read on mount and
/// every few minutes: it pages through every group, and a scrub's timestamp
/// changes slowly.
export function useScrubSummary(pools: string[], refreshKey: number, everyMs = 300_000) {
  const [sum, setSum] = useState<ScrubSummary | null>(null);
  const key = pools.join("\n");

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const names = key.split("\n");
    const run = async () => {
      const out: ScrubSummary = { scrubbed: 0, total: 0, running: 0, latest: 0, oldest: 0, bad: 0 };
      try {
        for (const pool of names) {
          let start = 0;
          for (let guard = 0; guard < 64; guard++) {
            const r = await placementGroups.list(pool, { start_at: start, max: 1000 });
            for (const pg of r.pgs) {
              out.total += 1;
              const s = pg.scrub;
              if (s?.running) out.running += 1;
              out.bad += s?.bad ?? 0;
              if (s?.last_complete) {
                out.scrubbed += 1;
                out.latest = Math.max(out.latest, s.last_complete);
                out.oldest = out.oldest ? Math.min(out.oldest, s.last_complete) : s.last_complete;
              }
            }
            if (!r.next_pg_id || r.next_pg_id <= start) break;
            start = r.next_pg_id;
          }
        }
        if (!cancelled) setSum(out);
      } catch {
        if (!cancelled) setSum(null);
      }
    };
    void run();
    const t = setInterval(() => void run(), everyMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [key, refreshKey, everyMs]);

  // No pools: nothing to page through, and nothing to wait for.
  return key ? sum : NO_GROUPS;
}

const NO_GROUPS: ScrubSummary = { scrubbed: 0, total: 0, running: 0, latest: 0, oldest: 0, bad: 0 };

export function ecLabel(p: PoolInfo): string {
  if (p.ec_type === 2) return `${p.replication_count} copies`;
  if (p.ec_type === 1) return `LRC ${p.ec_k}+${p.ec_local_parity}+${p.ec_global_parity}`;
  return `${p.ec_k}+${p.ec_m}`;
}
