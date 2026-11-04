import { useState } from "react";
import { Pause, Play, RefreshCw } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { Banner, Button } from "../components/ui";
import { rebalance as rebalanceApi } from "../api/client";
import { loadProtection, useProtection, type Protection } from "../api/protection";
import { useClusterSnapshot, useScrubSummary } from "../components/health/data";
import PgCard from "../components/health/PgCard";
import RepairCard from "../components/health/RepairCard";
import DrivesCard from "../components/health/DrivesCard";
import HostsTable from "../components/health/HostsTable";

/// Cluster health: is the data safe, what is being repaired, and which drive
/// is the problem. Protection comes from what peering last found of every
/// placement group (shared with the top bar's badge); the drives from the
/// nodes listing, placed in racks by meta's failure domains. There is no
/// event API yet, so the page has no events timeline.
export default function Health() {
  const shared = useProtection();
  const [fresh, setFresh] = useState<Protection | null>(null);
  const { snap, reload } = useClusterSnapshot();
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The shared poll runs every 30 s; a refresh reads protection now and
  // keeps that answer until the poll has a newer one.
  const p = fresh && (!shared || fresh.loadedAt > shared.loadedAt) ? fresh : shared;
  const scrub = useScrubSummary(
    p && p.level !== "unknown" ? p.pools.map((x) => x.pool) : [],
    refreshKey,
  );

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [np] = await Promise.all([loadProtection().catch(() => null), reload()]);
      if (np) setFresh(np);
      setRefreshKey((k) => k + 1);
    } finally {
      setRefreshing(false);
    }
  };

  const paused = snap?.rebalance?.paused ?? false;
  const toggleRebalance = async () => {
    setToggling(true);
    setError(null);
    try {
      if (paused) await rebalanceApi.resume();
      else await rebalanceApi.pause();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setToggling(false);
    }
  };

  const unknown = p?.level === "unknown";

  return (
    <div className="px-8 py-6 flex flex-col gap-4">
      <PageHeader
        title="Cluster health"
        description="Data protection, repair, and the drives under it"
        action={
          <>
            <Button
              icon={<RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />}
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              Refresh
            </Button>
            {snap?.rebalance && (
              <Button
                icon={paused ? <Play size={13} /> : <Pause size={13} />}
                onClick={() => void toggleRebalance()}
                disabled={toggling}
              >
                {paused ? "Resume rebalancing" : "Pause rebalancing"}
              </Button>
            )}
          </>
        }
      />

      {error && (
        <Banner kind="err" title="That didn't go through">
          {error}
        </Banner>
      )}

      {(unknown || snap?.error) && (
        <Banner kind="err" title="The cluster's state can't be read">
          The gateway can't reach the metadata service, so{" "}
          {unknown && snap?.error
            ? "protection, repair and drives"
            : unknown
              ? "protection and repair"
              : "the drives"}{" "}
          can't be shown. This page tries again on its own.
        </Banner>
      )}

      {!p || !snap ? (
        <Loading />
      ) : (
        <>
          {!unknown && (
            <div className="grid gap-4 items-start grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))]">
              <PgCard p={p} pools={snap.pools} />
              <RepairCard
                p={p}
                drains={snap.drains}
                drives={snap.drives}
                rebalance={snap.rebalance}
                scrub={scrub}
                now={snap.loadedAt}
              />
            </div>
          )}
          {!snap.error && (
            <>
              <DrivesCard snap={snap} onChanged={() => void reload()} />
              <HostsTable hosts={snap.hosts} racksConfigured={snap.racksConfigured} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))]" aria-busy="true">
      {["Placement groups", "Repair"].map((t) => (
        <section
          key={t}
          className="bg-surface border border-border rounded-card shadow-card p-4 flex flex-col gap-4 min-h-[180px]"
        >
          <h2 className="text-[13px] font-semibold text-text">{t}</h2>
          <div className="h-0.5 w-full bg-surface-2 rounded overflow-hidden">
            <div className="h-full w-1/3 bg-accent animate-loading-bar" />
          </div>
          <p className="text-[12px] text-muted">Reading the cluster's state…</p>
        </section>
      ))}
    </div>
  );
}
