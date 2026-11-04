import { useEffect, useState } from "react";
import { placementGroups, request, type PlacementGroup } from "./client";

/// How well the cluster's data is protected right now, from what peering last
/// found of every placement group.
///
/// - clean: every shard in place.
/// - rebuilding: a shard is missing or stale and recovery is putting it back;
///   every object still reads.
/// - atRisk: one more loss would lose data (no spare left), or the group
///   can't serve at all (Down, Incomplete).
export type ProtectionLevel = "protected" | "rebuilding" | "at-risk" | "unknown";

export interface PoolProtection {
  pool: string;
  total: number;
  clean: number;
  rebuilding: number;
  atRisk: number;
  /// Objects and bytes recovery still has to rebuild in this pool.
  objectsRemaining: number;
  bytesRemaining: number;
}

export interface Protection {
  level: ProtectionLevel;
  total: number;
  clean: number;
  rebuilding: number;
  atRisk: number;
  objectsRemaining: number;
  bytesRemaining: number;
  pools: PoolProtection[];
  /// The groups that aren't clean, most severe first.
  notClean: PlacementGroup[];
  loadedAt: number;
}

const SEVERE = new Set(["Down", "Incomplete"]);

export function classify(pg: PlacementGroup): "clean" | "rebuilding" | "atRisk" {
  const s = pg.state;
  if (!s || s.state === "Clean") return "clean";
  if (SEVERE.has(s.state) || s.min_spare <= 0) return "atRisk";
  return "rebuilding";
}

interface PoolName {
  name: string;
}

export async function loadProtection(): Promise<Protection> {
  const list = await request<PoolName[] | { pools: PoolName[] }>("GET", "/_admin/pools");
  const pools = Array.isArray(list) ? list : (list.pools ?? []);
  const per = await Promise.all(
    pools.map(async (p) => {
      const pgs: PlacementGroup[] = [];
      let start = 0;
      // A pool's groups come a page at a time; the last page has no next id.
      for (let guard = 0; guard < 64; guard++) {
        const r = await placementGroups.list(p.name, { start_at: start, max: 1000 });
        pgs.push(...r.pgs);
        if (!r.next_pg_id || r.next_pg_id <= start) break;
        start = r.next_pg_id;
      }
      return { pool: p.name, pgs };
    }),
  );
  const out: Protection = {
    level: "protected",
    total: 0,
    clean: 0,
    rebuilding: 0,
    atRisk: 0,
    objectsRemaining: 0,
    bytesRemaining: 0,
    pools: [],
    notClean: [],
    loadedAt: Date.now(),
  };
  for (const { pool, pgs } of per) {
    const pp: PoolProtection = { pool, total: pgs.length, clean: 0, rebuilding: 0, atRisk: 0, objectsRemaining: 0, bytesRemaining: 0 };
    for (const pg of pgs) {
      const c = classify(pg);
      pp[c] += 1;
      pp.objectsRemaining += pg.state?.recovery?.remaining ?? 0;
      pp.bytesRemaining += pg.state?.recovery?.bytes_remaining ?? 0;
      if (c !== "clean") out.notClean.push(pg);
    }
    out.pools.push(pp);
    out.total += pp.total;
    out.clean += pp.clean;
    out.rebuilding += pp.rebuilding;
    out.atRisk += pp.atRisk;
    out.objectsRemaining += pp.objectsRemaining;
    out.bytesRemaining += pp.bytesRemaining;
  }
  out.notClean.sort((a, b) => (classify(a) === "atRisk" ? 0 : 1) - (classify(b) === "atRisk" ? 0 : 1));
  out.level = out.atRisk > 0 ? "at-risk" : out.rebuilding > 0 ? "rebuilding" : "protected";
  return out;
}

/// The cluster's protection, refreshed every `everyMs`. `null` until the first
/// answer; `level: "unknown"` when it can't be read (a tenant's console, or
/// meta unreachable). Several components on a page share one poll.
export function useProtection(enabled = true, everyMs = 30_000): Protection | null {
  const [p, setP] = useState<Protection | null>(shared.value);
  useEffect(() => {
    if (!enabled) return;
    const on = (v: Protection) => setP(v);
    shared.listeners.add(on);
    shared.start(everyMs);
    return () => {
      shared.listeners.delete(on);
      shared.stopIfIdle();
    };
  }, [enabled, everyMs]);
  return enabled ? p : null;
}

const UNKNOWN: Omit<Protection, "loadedAt"> = {
  level: "unknown",
  total: 0,
  clean: 0,
  rebuilding: 0,
  atRisk: 0,
  objectsRemaining: 0,
  bytesRemaining: 0,
  pools: [],
  notClean: [],
};

const shared = {
  value: null as Protection | null,
  listeners: new Set<(p: Protection) => void>(),
  timer: 0 as ReturnType<typeof setInterval> | 0,
  async tick() {
    try {
      shared.value = await loadProtection();
    } catch {
      shared.value = { ...UNKNOWN, loadedAt: Date.now() };
    }
    for (const l of shared.listeners) l(shared.value);
  },
  start(everyMs: number) {
    if (shared.timer) {
      if (shared.value) for (const l of shared.listeners) l(shared.value);
      return;
    }
    void shared.tick();
    shared.timer = setInterval(() => void shared.tick(), everyMs);
  },
  stopIfIdle() {
    if (shared.listeners.size === 0 && shared.timer) {
      clearInterval(shared.timer);
      shared.timer = 0;
    }
  },
};
