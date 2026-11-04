import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, RefreshCw } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { Button, Tabs } from "../components/ui";
import { nodes as nodesApi, type NodeInfo } from "../api/client";
import Topology from "./Topology";
import Drives from "./Drives";
import Pools from "./Pools";
import Balancing from "./Balancing";

type TabKey = "topology" | "drives" | "pools" | "balancing";

const ALL: TabKey[] = ["topology", "drives", "pools", "balancing"];

/// The node views share one page with tabs; pools are a page of their own
/// (the sidebar's "Pools and placement").
const NODE_TABS: Array<{ key: TabKey; label: string }> = [
  { key: "drives", label: "Drives" },
  { key: "topology", label: "Topology" },
  { key: "balancing", label: "Balancing" },
];

/// /cluster/:tab. "Nodes and drives" is /cluster/drives (with Topology and
/// Balancing as tabs); "Pools and placement" is /cluster/pools. The old
/// `/topology`, `/drives` and `/pools` routes redirect here via App.tsx.
export default function Cluster() {
  const nav = useNavigate();
  const { tab: urlTab } = useParams<{ tab?: string }>();
  const [hosts, setHosts] = useState<NodeInfo[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  const active: TabKey = useMemo(() => {
    return (ALL.includes(urlTab as TabKey) ? urlTab : "drives") as TabKey;
  }, [urlTab]);

  const loadHosts = useCallback(() => {
    nodesApi.list().then((d) => setHosts(d.nodes ?? [])).catch(() => setHosts([]));
  }, []);

  useEffect(() => {
    // Normalise the URL so refresh lands on the same tab.
    if (!urlTab) nav("/cluster/drives", { replace: true });
  }, [urlTab, nav]);

  useEffect(() => {
    loadHosts();
  }, [loadHosts, reloadKey]);

  // Host health summarised in the header, so the state of the cluster is
  // visible from every tab rather than only the one that happens to list it.
  // "warn" is a host that is up but has a disk reporting something other than
  // healthy — degraded but still serving, which neither up nor down conveys.
  const up = hosts.filter((h) => h.online).length;
  const warn = hosts.filter(
    (h) => h.online && (h.disks ?? []).some((d) => d.status && d.status !== "healthy")
  ).length;
  const down = hosts.length - up;
  const isPools = active === "pools";

  return (
    <div className="px-8 py-6">
      <PageHeader
        title={isPools ? "Pools and placement" : "Nodes and drives"}
        description={isPools ? "Where data goes, and how it's protected" : "Hosts, OSDs and the disks under them"}
        action={
          <div className="flex items-center gap-4">
            <div className={`${isPools ? "hidden" : "hidden sm:flex"} items-center gap-3 text-[12px]`}>
              <span className="inline-flex items-center gap-1.5 text-text-2">
                <span className="w-[6px] h-[6px] rounded-full bg-ok" />
                {up} host{up === 1 ? "" : "s"} up
              </span>
              <span className="inline-flex items-center gap-1.5 text-text-2">
                <span className="w-[6px] h-[6px] rounded-full bg-warn-dot" />
                {warn} warn
              </span>
              <span className="inline-flex items-center gap-1.5 text-text-2">
                <span className="w-[6px] h-[6px] rounded-full bg-err" />
                {down} down
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                icon={<RefreshCw size={13} />}
                onClick={() => setReloadKey((k) => k + 1)}
              >
                Refresh
              </Button>
              {!isPools && (
                <Button
                  variant="secondary"
                  icon={<Plus size={13} />}
                  onClick={() => nav("/cluster/drives")}
                >
                  Add host
                </Button>
              )}
            </div>
          </div>
        }
      />

      {!isPools && (
        <Tabs
          variant="underline"
          value={active}
          onChange={(k) => nav(`/cluster/${k}`)}
          items={NODE_TABS}
          className="mb-5"
        />
      )}

      <div key={reloadKey}>
        {active === "topology" && <Topology embedded />}
        {active === "drives" && <Drives embedded />}
        {active === "pools" && <Pools embedded />}
        {active === "balancing" && <Balancing />}
      </div>
    </div>
  );
}
