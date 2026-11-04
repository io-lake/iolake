import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { Badge, Banner, Button, Cell, Input, Select } from "../components/ui";
import { useProtection } from "../api/protection";
import BucketPanel, { PublicBadge } from "../components/buckets/BucketPanel";
import CreateBucket from "../components/buckets/CreateBucket";
import { CardFrame, SelectableRow, Th } from "../components/buckets/parts";
import { useNow } from "../components/buckets/hooks";
import {
  deleteBucket,
  effectivePublic,
  formatAgo,
  formatBytes,
  formatCount,
  loadBucketPolicy,
  loadBuckets,
  loadPools,
  loadPublicAccessBlock,
  loadUsage,
  loadUsers,
  mapLimit,
  poolName,
  readPolicy,
  schemeShort,
  tenantName,
  versioningOf,
  type BucketInfo,
  type PolicyDoc,
  type PoolInfo,
  type PublicAccessBlock,
  type UsageReport,
  type UserInfo,
} from "../components/buckets/model";

type Pill = "all" | "versioned" | "suspended" | "public";

const PILLS: [Pill, string][] = [
  ["all", "All"],
  ["versioned", "Versioned"],
  ["suspended", "Suspended"],
  ["public", "Public"],
];

export default function Buckets() {
  const [params, setParams] = useSearchParams();
  const selectedName = params.get("bucket") ?? "";

  const [buckets, setBuckets] = useState<BucketInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [usageErr, setUsageErr] = useState("");
  const [pools, setPools] = useState<PoolInfo[] | null>(null);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [block, setBlock] = useState<PublicAccessBlock | null>(null);
  /// Each bucket's policy; a missing key is still loading.
  const [policies, setPolicies] = useState<Record<string, PolicyDoc | null>>({});

  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState("");
  const [tenantF, setTenantF] = useState("*");
  const [poolF, setPoolF] = useState("*");
  const [pill, setPill] = useState<Pill>("all");
  const [notice, setNotice] = useState("");
  const now = useNow();
  const protection = useProtection();

  // Buckets first, so the table shows as soon as meta answers; usage, pools
  // and the rest fill in as they come. None of them is required: a tenant's
  // console gets 403 for pools, and usage is 503 until its first pass.
  const load = useCallback(async () => {
    try {
      const list = await loadBuckets();
      setBuckets(list);
      setLoadErr("");
      // Public access is per bucket and only the policy says it, so every
      // bucket's policy is read, a few at a time.
      void mapLimit(list, 6, async (b) => {
        const p = await loadBucketPolicy(b.name).catch(() => null);
        setPolicies((cur) => ({ ...cur, [b.name]: p }));
      });
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    loadUsage()
      .then((u) => {
        setUsage(u);
        setUsageErr("");
      })
      .catch((e: Error) => setUsageErr(e.message.startsWith("503") ? "gathering" : "unavailable"));
  }, []);

  useEffect(() => {
    void load();
    loadPools().then(setPools).catch(() => setPools(null));
    loadUsers().then(setUsers).catch(() => setUsers([]));
    loadPublicAccessBlock().then(setBlock).catch(() => setBlock(null));
  }, [load]);

  // Usage is gathered every few seconds; a page left open keeps up with it.
  useEffect(() => {
    const t = setInterval(() => {
      loadUsage().then(setUsage).catch(() => {});
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  const usageBy = useMemo(() => new Map((usage?.buckets ?? []).map((u) => [u.bucket, u])), [usage]);
  const poolBy = useMemo(() => new Map((pools ?? []).map((p) => [p.name, p])), [pools]);
  const tenants = useMemo(() => [...new Set(buckets.map((b) => b.tenant ?? ""))].sort(), [buckets]);
  const poolNames = useMemo(() => [...new Set(buckets.map((b) => poolName(b.pool)))].sort(), [buckets]);

  const isPublic = useCallback(
    (name: string) => {
      const p = policies[name];
      return p !== undefined && effectivePublic(readPolicy(p).public, block).level !== "private";
    },
    [policies, block],
  );

  const pillMatch = (b: BucketInfo, p: Pill) =>
    p === "all" ||
    (p === "versioned" && b.versioning === 1) ||
    (p === "suspended" && b.versioning === 2) ||
    (p === "public" && isPublic(b.name));

  const q = query.trim().toLowerCase();
  const filtered = buckets.filter(
    (b) =>
      (!q || b.name.toLowerCase().includes(q) || tenantName(b.tenant).toLowerCase().includes(q)) &&
      (tenantF === "*" || (b.tenant ?? "") === tenantF) &&
      (poolF === "*" || poolName(b.pool) === poolF),
  );
  const visible = filtered.filter((b) => pillMatch(b, pill)).sort((a, b) => a.name.localeCompare(b.name));
  const selected = buckets.find((b) => b.name === selectedName);

  const select = (name: string) => {
    const next = new URLSearchParams(params);
    if (name && name !== selectedName) next.set("bucket", name);
    else next.delete("bucket");
    setParams(next, { replace: true });
  };

  const totalStored = (usage?.buckets ?? []).reduce((a, u) => a + u.logical_bytes, 0);
  const description = loading
    ? "Loading buckets…"
    : [
        `${buckets.length} bucket${buckets.length === 1 ? "" : "s"}`,
        usage ? `${formatBytes(totalStored)} stored${tenants.length > 1 ? ` across ${tenants.length} tenants` : ""}` : null,
      ]
        .filter(Boolean)
        .join(" · ");

  const userName = (id: string | undefined) => (id ? users.find((u) => u.user_id === id)?.display_name : undefined);

  const footer = (() => {
    const shown = `Showing ${visible.length} of ${buckets.length}`;
    if (usage) return `${shown} · sizes as of ${formatAgo(usage.updated_at, now)}`;
    if (usageErr === "gathering") return `${shown} · sizes appear once the gateway has gathered usage, within a minute`;
    if (usageErr) return `${shown} · sizes aren't available to this console`;
    return shown;
  })();

  return (
    <div className="px-8 py-6 flex flex-col gap-4">
      <PageHeader
        title="Buckets"
        description={description}
        action={
          <Button variant="primary" icon={<Plus size={13} />} onClick={() => setShowCreate(true)}>
            Create bucket
          </Button>
        }
      />

      {showCreate && (
        <CreateBucket
          pools={pools}
          onCancel={() => setShowCreate(false)}
          onCreated={(name) => {
            setShowCreate(false);
            setNotice(`Bucket ${name} created`);
            void load().then(() => select(name));
          }}
        />
      )}
      {notice && (
        <Banner
          kind="ok"
          title={notice}
          action={
            <Button size="sm" variant="ghost" onClick={() => setNotice("")}>
              Dismiss
            </Button>
          }
        />
      )}
      {loadErr && (
        <Banner kind="err" title="Couldn't list buckets">
          {loadErr}
        </Banner>
      )}

      <div className={`grid gap-4 items-start ${selected ? "xl:grid-cols-[minmax(0,1fr)_380px]" : ""}`}>
        <CardFrame label="Bucket list" className="overflow-hidden">
          <div className="flex gap-2 p-3 flex-wrap items-center border-b border-border">
            <div className="flex-[1_1_240px] min-w-[200px]">
              <Input
                type="search"
                aria-label="Filter buckets"
                icon={<Search size={13} />}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by name or tenant"
              />
            </div>
            {tenants.length > 1 && (
              <div className="w-40">
                <Select aria-label="Tenant" value={tenantF} onChange={(e) => setTenantF(e.target.value)}>
                  <option value="*">All tenants</option>
                  {tenants.map((t) => (
                    <option key={t} value={t}>
                      {tenantName(t)}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {poolNames.length > 1 && (
              <div className="w-40">
                <Select aria-label="Pool" value={poolF} onChange={(e) => setPoolF(e.target.value)}>
                  <option value="*">All pools</option>
                  {poolNames.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div
              role="group"
              aria-label="Show"
              className="inline-flex gap-0.5 p-0.5 bg-surface-2 border border-border rounded-control"
            >
              {PILLS.map(([key, label]) => {
                const n = filtered.filter((b) => pillMatch(b, key)).length;
                const on = pill === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPill(key)}
                    className={`h-7 px-2.5 rounded-[6px] text-[12px] font-medium inline-flex items-center gap-1.5 ${
                      on ? "bg-surface text-text shadow-card" : "text-muted hover:text-text"
                    }`}
                  >
                    {label}
                    <span className="font-mono text-[10.5px] tabular-nums text-muted">{n}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[700px]">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Tenant</Th>
                  <Th>Pool</Th>
                  <Th align="right">Stored</Th>
                  <Th align="right">Objects</Th>
                  <Th>Versioning</Th>
                  <Th>Public access</Th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={7} className="px-3.5">
                      <div className="h-16 flex items-center">
                        <div className="h-0.5 w-full bg-surface-2 rounded overflow-hidden">
                          <div className="h-full w-1/3 bg-accent animate-[loading-bar_1.2s_ease-in-out_infinite]" />
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                {!loading && visible.length === 0 && (
                  <tr className="border-t border-border">
                    <td colSpan={7} className="px-3.5 py-10 text-center text-[12.5px] text-muted">
                      {buckets.length === 0 ? (
                        <>
                          No buckets yet.{" "}
                          <button type="button" className="text-accent hover:underline" onClick={() => setShowCreate(true)}>
                            Create a bucket
                          </button>{" "}
                          to start storing objects.
                        </>
                      ) : (
                        "No bucket matches these filters."
                      )}
                    </td>
                  </tr>
                )}
                {visible.map((b) => {
                  const u = usageBy.get(b.name);
                  const v = versioningOf(b.versioning);
                  const isSel = b.name === selectedName;
                  const scheme = schemeShort(poolBy.get(poolName(b.pool)));
                  return (
                    <SelectableRow key={b.name} selected={isSel} onSelect={() => select(b.name)}>
                      <Cell>
                        <button
                          type="button"
                          aria-pressed={isSel}
                          onClick={(e) => {
                            e.stopPropagation();
                            select(b.name);
                          }}
                          className={`font-mono text-[12.5px] font-medium text-left whitespace-nowrap hover:underline ${
                            isSel ? "text-accent" : "text-text hover:text-accent"
                          }`}
                        >
                          {b.name}
                        </button>
                      </Cell>
                      <Cell className="whitespace-nowrap">{tenantName(b.tenant)}</Cell>
                      <Cell className="whitespace-nowrap">
                        <span className="font-mono">{poolName(b.pool)}</span>
                        {scheme && <span className="text-muted"> · {scheme}</span>}
                      </Cell>
                      <Cell align="right" className="tabular-nums whitespace-nowrap">
                        {u ? formatBytes(u.logical_bytes) : <span className="text-muted">—</span>}
                      </Cell>
                      <Cell align="right" className="tabular-nums">
                        {u ? formatCount(u.objects) : <span className="text-muted">—</span>}
                      </Cell>
                      <Cell>
                        {v === "on" ? (
                          <span className="text-text">On</span>
                        ) : v === "suspended" ? (
                          <Badge kind="warn">Suspended</Badge>
                        ) : (
                          <span className="text-muted">Off</span>
                        )}
                      </Cell>
                      <Cell>
                        <PublicBadge policy={policies[b.name]} block={block} />
                      </Cell>
                    </SelectableRow>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!loading && buckets.length > 0 && (
            <div className="px-3.5 py-2.5 border-t border-border text-[12px] text-muted">{footer}</div>
          )}
        </CardFrame>

        {selected && (
          <BucketPanel
            key={selected.name}
            bucket={selected}
            usage={usageBy.get(selected.name)}
            pool={poolBy.get(poolName(selected.pool))}
            health={protection?.pools.find((p) => p.pool === poolName(selected.pool))}
            policy={policies[selected.name]}
            block={block}
            ownerName={userName(selected.owner)}
            onClose={() => select("")}
            onDelete={async () => {
              await deleteBucket(selected.name);
              setNotice(`Bucket ${selected.name} deleted`);
              select("");
              await load();
            }}
          />
        )}
      </div>
    </div>
  );
}
