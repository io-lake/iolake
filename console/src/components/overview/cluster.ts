import type { NodeInfo } from "../../api/client";
import { classify, type Protection } from "../../api/protection";

/// The parts of `GET /_admin/pools` the overview reads.
export interface Pool {
  name: string;
  /// 0 erasure coding (MDS), 1 LRC, 2 replication.
  ec_type: number;
  ec_k: number;
  ec_m: number;
  ec_local_parity: number;
  ec_global_parity: number;
  replication_count: number;
  failure_domain: string;
  pg_count: number;
  enabled: boolean;
}

/// The cluster section of `GET /_admin/usage` (absent for a tenant caller).
export interface ClusterUsage {
  raw_capacity_bytes: number;
  raw_used_bytes: number;
  usable_capacity_bytes: number;
  logical_bytes: number;
  stored_bytes: number;
  objects: number;
  buckets: number;
  osds_total: number;
  osds_up: number;
}

export interface TenantUsage {
  tenant: string;
  buckets: number;
  objects: number;
  logical_bytes: number;
  stored_bytes: number;
  quota_bytes: number;
}

export interface Usage {
  updated_at: number;
  cluster: ClusterUsage | null;
  tenants: TenantUsage[];
}

/// `4+2`, `LRC 4+1+2`, `3×`.
export function schemeShort(p: Pool): string {
  if (p.ec_type === 2) return `${p.replication_count}×`;
  if (p.ec_type === 1) return `LRC ${p.ec_k}+${p.ec_local_parity}+${p.ec_global_parity}`;
  return `${p.ec_k}+${p.ec_m}`;
}

/// `erasure coding 4+2`, `LRC 4+1+2`, `3× replication`.
export function schemeLong(p: Pool): string {
  if (p.ec_type === 2) return `${p.replication_count}× replication`;
  if (p.ec_type === 1) return schemeShort(p);
  return `erasure coding ${schemeShort(p)}`;
}

/// How many drives a pool's objects can lose and still be read: the parity
/// count, a replica count less one, or LRC's global parity (as the pool
/// editor states it). Each shard sits in its own failure domain, which is at
/// least a drive, so the same number holds for drives anywhere.
export function tolerance(p: Pool): number {
  if (p.ec_type === 2) return Math.max(0, p.replication_count - 1);
  if (p.ec_type === 1) return p.ec_global_parity;
  return p.ec_m;
}

/// The name an operator recognises an OSD by.
export function osdName(n: NodeInfo): string {
  return n.node_name || `osd-${n.node_id.slice(0, 8)}`;
}

export function hostName(n: NodeInfo): string {
  return n.hostname || n.node_name || n.node_id;
}

/// The last part of a drive's path, which is what tells drives on one OSD
/// apart (`disk0/disk.raw`, `nvme1n1`).
export function driveName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || path;
}

/// The groups `useProtection` counts as rebuilding, by what is actually
/// happening to them. `Undersized` is counted there too, but nothing is
/// rebuilding it: a shard position has no usable OSD and none can stand in,
/// so it waits for an OSD to come back or be added.
export function rebuildBreakdown(p: Protection): { working: number; undersized: number; waitFull: number } {
  const out = { working: 0, undersized: 0, waitFull: 0 };
  for (const pg of p.notClean) {
    if (classify(pg) !== "rebuilding") continue;
    const s = pg.state?.state;
    if (s === "Undersized") out.undersized += 1;
    else if (s === "WaitTooFull") out.waitFull += 1;
    else out.working += 1;
  }
  return out;
}
