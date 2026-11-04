import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Copy, Upload } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { Banner, Button, Tabs } from "../components/ui";
import { useCrumbs } from "../shell/crumbs";
import { useProtection } from "../api/protection";
import ObjectBrowser from "../components/buckets/ObjectBrowser";
import { AccessTab, LifecycleTab, SettingsTab } from "../components/buckets/SettingsTabs";
import { LinkButton } from "../components/buckets/parts";
import { useBucketSettings } from "../components/buckets/hooks";
import {
  copyText,
  deleteBucket,
  formatBytes,
  formatCount,
  loadBucketPolicy,
  loadBuckets,
  loadPools,
  loadPublicAccessBlock,
  loadUsage,
  loadUsers,
  parseLifecycle,
  poolName,
  putObject,
  schemeShort,
  tenantName,
  versioningOf,
  type BucketInfo,
  type BucketUsage,
  type PolicyDoc,
  type PoolInfo,
  type PublicAccessBlock,
  type UserInfo,
} from "../components/buckets/model";

type Tab = "objects" | "settings" | "access" | "lifecycle";
const TABS: Tab[] = ["objects", "settings", "access", "lifecycle"];

/// The admin object route carries a 100 MiB body limit; larger files need
/// an S3 client's multipart upload.
const UPLOAD_LIMIT = 100 * 1024 * 1024;

export default function BucketDetail() {
  const { bucketName = "" } = useParams<{ bucketName: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tabParam = params.get("tab") as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : "objects";
  const prefix = params.get("prefix") ?? "";
  const objectKey = params.get("object") ?? "";

  useCrumbs([{ label: bucketName, mono: true }]);

  const [bucket, setBucket] = useState<BucketInfo | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [usage, setUsage] = useState<BucketUsage | undefined>(undefined);
  const [pools, setPools] = useState<PoolInfo[] | null>(null);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [block, setBlock] = useState<PublicAccessBlock | null>(null);
  const [policy, setPolicy] = useState<{ bucket: string; doc: PolicyDoc | null } | null>(null);
  const { settings, reload: reloadSettings } = useBucketSettings(bucketName);
  const protection = useProtection();

  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Bumped after a change that the bucket list or usage reflects.
  const [rev, setRev] = useState(0);
  const loadBucket = useCallback(() => setRev((r) => r + 1), []);

  useEffect(() => {
    let cancelled = false;
    loadBuckets()
      .then((list) => {
        if (cancelled) return;
        const b = list.find((x) => x.name === bucketName) ?? null;
        setBucket(b);
        setMissing(!b);
        setLoadErr("");
      })
      .catch((e: Error) => !cancelled && setLoadErr(e.message));
    loadUsage()
      .then((u) => !cancelled && setUsage(u.buckets.find((x) => x.bucket === bucketName)))
      .catch(() => !cancelled && setUsage(undefined));
    return () => {
      cancelled = true;
    };
  }, [bucketName, rev]);

  const [policyRev, setPolicyRev] = useState(0);
  const loadPolicy = useCallback(() => setPolicyRev((r) => r + 1), []);
  useEffect(() => {
    let cancelled = false;
    loadBucketPolicy(bucketName)
      .catch(() => null)
      .then((doc) => !cancelled && setPolicy({ bucket: bucketName, doc }));
    return () => {
      cancelled = true;
    };
  }, [bucketName, policyRev]);

  useEffect(() => {
    loadPools().then(setPools).catch(() => setPools(null));
    loadUsers().then(setUsers).catch(() => setUsers([]));
    loadPublicAccessBlock().then(setBlock).catch(() => setBlock(null));
  }, []);

  const pool = useMemo(() => pools?.find((p) => p.name === poolName(bucket?.pool)), [pools, bucket]);
  const health = protection?.pools.find((p) => p.pool === poolName(bucket?.pool));
  const policyDoc = policy && policy.bucket === bucketName ? policy.doc : undefined;

  const setQuery = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next);
  };

  const upload = async (files: FileList) => {
    setError("");
    const list = Array.from(files);
    const tooBig = list.filter((f) => f.size > UPLOAD_LIMIT);
    for (const [i, f] of list.entries()) {
      if (f.size > UPLOAD_LIMIT) continue;
      setBusy(list.length === 1 ? `Uploading ${f.name}` : `Uploading ${i + 1} of ${list.length}: ${f.name}`);
      try {
        await putObject(bucketName, prefix + f.name, f, f.type);
      } catch (e) {
        setError(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
    }
    if (tooBig.length)
      setError(
        `${tooBig.map((f) => f.name).join(", ")} ${tooBig.length === 1 ? "is" : "are"} over 100 MiB. The console uploads a file in one request; use an S3 client for larger files.`,
      );
    setBusy("");
    setReloadKey((k) => k + 1);
    loadBucket();
  };

  const startUpload = () => {
    if (tab !== "objects") setQuery({ tab: "" });
    fileInput.current?.click();
  };

  const v = bucket ? versioningOf(bucket.versioning) : "off";
  const scheme = schemeShort(pool);
  const description = bucket ? (
    <>
      {tenantName(bucket.tenant)} · <span className="font-mono">{poolName(bucket.pool)}</span>
      {scheme ? ` ${scheme}` : ""}
      {usage ? ` · ${formatCount(usage.objects)} object${usage.objects === 1 ? "" : "s"} · ${formatBytes(usage.logical_bytes)}` : ""}
      {` · versioning ${v === "on" ? "on" : v === "suspended" ? "suspended" : "off"}`}
    </>
  ) : missing ? (
    "Not found"
  ) : (
    "Loading…"
  );

  const lifecycleCount = settings?.lifecycle.state === "set" ? parseLifecycle(settings.lifecycle.doc).length : undefined;

  return (
    <div className="px-8 py-6 flex flex-col gap-4">
      <PageHeader
        title={bucketName}
        mono
        description={description}
        action={
          <>
            <Button
              icon={<Copy size={13} />}
              onClick={() => {
                copyText(`s3://${bucketName}/${tab === "objects" ? prefix : ""}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Copied" : "Copy S3 URI"}
            </Button>
            <Button variant="primary" icon={<Upload size={13} />} onClick={startUpload} disabled={!bucket || !!busy}>
              Upload
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              aria-hidden="true"
              tabIndex={-1}
              onChange={(e) => {
                if (e.target.files?.length) void upload(e.target.files);
                e.target.value = "";
              }}
            />
          </>
        }
      />

      {missing ? (
        <Banner kind="warn" title={`There's no bucket named ${bucketName}`} action={<LinkButton to="/buckets" size="sm">All buckets</LinkButton>}>
          It may have been deleted, or the name is misspelled.
        </Banner>
      ) : (
        <>
          <Tabs
            variant="underline"
            value={tab}
            onChange={(k) => setQuery({ tab: k === "objects" ? "" : k })}
            items={[
              { key: "objects", label: "Objects" },
              { key: "settings", label: "Settings" },
              { key: "access", label: "Access" },
              { key: "lifecycle", label: "Lifecycle", count: lifecycleCount },
            ]}
          />

          {busy && <Banner kind="info" title={`${busy}…`} />}
          {error && (
            <Banner
              kind="err"
              title="That didn't go through"
              action={
                <Button size="sm" variant="ghost" onClick={() => setError("")}>
                  Dismiss
                </Button>
              }
            >
              {error}
            </Banner>
          )}
          {loadErr && (
            <Banner kind="err" title="Couldn't read the bucket">
              {loadErr}
            </Banner>
          )}

          {bucket && tab === "objects" && (
            <ObjectBrowser
              bucket={bucket}
              pool={pool}
              prefix={prefix}
              onPrefix={(p) => setQuery({ prefix: p, object: "" })}
              selectedKey={objectKey}
              onSelect={(k) => setQuery({ object: k })}
              reloadKey={reloadKey}
              onBusy={setBusy}
              onError={setError}
              onChanged={loadBucket}
            />
          )}
          {bucket && tab === "settings" && (
            <SettingsTab
              bucket={bucket}
              usage={usage}
              pool={pool}
              health={health}
              settings={settings}
              reloadSettings={reloadSettings}
              onBucketChanged={loadBucket}
              onDelete={async () => {
                await deleteBucket(bucketName);
                navigate("/buckets", { replace: true });
              }}
            />
          )}
          {bucket && tab === "access" && (
            <AccessTab
              bucket={bucket}
              users={users}
              policy={policyDoc}
              block={block}
              onOwnerChanged={loadBucket}
              onPolicyChanged={loadPolicy}
            />
          )}
          {bucket && tab === "lifecycle" && (
            <LifecycleTab bucket={bucketName} setting={settings?.lifecycle} onSaved={reloadSettings} />
          )}
        </>
      )}
    </div>
  );
}
