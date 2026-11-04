import { useState, type ReactNode } from "react";
import { FolderOpen, Settings2, ShieldCheck, ShieldAlert, Trash2 } from "lucide-react";
import { Badge } from "../ui";
import type { PoolProtection } from "../../api/protection";
import { DangerTextButton, DetailsPanel, Kv, LinkButton, Overline, PanelSection } from "./parts";
import { useBucketSettings } from "./hooks";
import {
  effectivePublic,
  encryptionWords,
  formatBytes,
  formatCount,
  formatDate,
  layoutSentence,
  lifecycleWords,
  lockWords,
  parseLifecycle,
  parseLock,
  poolName,
  protectionSentence,
  PUBLIC_WORDS,
  readPolicy,
  replicationWords,
  tenantName,
  versioningOf,
  type BucketInfo,
  type BucketUsage,
  type PolicyDoc,
  type PoolInfo,
  type PublicAccessBlock,
  type S3Setting,
} from "./model";

/// Who the bucket's policy names, in words.
function policyWords(policy: PolicyDoc | null): string {
  if (!policy) return "No bucket policy; the owner and IAM policies decide";
  const p = readPolicy(policy);
  const parts: string[] = [];
  if (p.public === "read") parts.push("anyone can read");
  if (p.public === "write") parts.push("anyone can read and write");
  if (p.principals.length)
    parts.push(`${p.principals.length} named principal${p.principals.length === 1 ? "" : "s"}`);
  const s = `${p.statements} statement${p.statements === 1 ? "" : "s"}${parts.length ? ` · ${parts.join(", ")}` : ""}`;
  return s;
}

export function PublicBadge({
  policy,
  block,
}: {
  policy: PolicyDoc | null | undefined;
  block: PublicAccessBlock | null;
}) {
  if (policy === undefined) return <span className="text-muted">…</span>;
  const { level, blocked } = effectivePublic(readPolicy(policy).public, block);
  if (level === "private")
    return <span className={blocked ? "text-warn" : "text-muted"}>{blocked ? "Private (public policy blocked)" : "Private"}</span>;
  return <Badge kind={level === "write" ? "err" : "warn"}>{PUBLIC_WORDS[level]}</Badge>;
}

export function ProtectionHealth({ health }: { health: PoolProtection | undefined }) {
  if (!health || health.total === 0) return null;
  if (health.atRisk > 0) return <Badge kind="err">At risk</Badge>;
  if (health.rebuilding > 0) return <Badge kind="warn">Rebuilding</Badge>;
  return <Badge kind="ok">All shards in place</Badge>;
}

export default function BucketPanel({
  bucket,
  usage,
  pool,
  health,
  policy,
  block,
  ownerName,
  onClose,
  onDelete,
}: {
  bucket: BucketInfo;
  usage: BucketUsage | undefined;
  pool: PoolInfo | undefined;
  health: PoolProtection | undefined;
  /// `undefined` while loading, `null` when the bucket has none.
  policy: PolicyDoc | null | undefined;
  block: PublicAccessBlock | null;
  ownerName: string | undefined;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const { settings } = useBucketSettings(bucket.name);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");
  const href = `/buckets/${encodeURIComponent(bucket.name)}`;
  const v = versioningOf(bucket.versioning);

  // Settings S3 keeps as sub-resources. The ones the gateway refused are
  // named once below instead of a row of "unknown"s.
  const refused: string[] = [];
  const row = (label: string, s: S3Setting | undefined, words: (d: Document) => string): [string, ReactNode] | null => {
    if (!s) return [label, <span className="text-muted">…</span>];
    if (s.state === "set") return [label, words(s.doc)];
    if (s.state === "none") return [label, "Off"];
    if (s.state === "refused") {
      refused.push(label.toLowerCase());
      return null;
    }
    return [label, <span className="text-muted">Couldn't read ({s.message})</span>];
  };
  const settingRows = [
    [
      "Versioning",
      v === "on" ? "On, every overwrite keeps the earlier version" : v === "suspended" ? "Suspended: earlier versions kept, new writes replace" : "Off",
    ] as [string, ReactNode],
    row("Object lock", settings?.lock, (d) => lockWords(parseLock(d))),
    row("Encryption", settings?.encryption, encryptionWords),
    row("Lifecycle", settings?.lifecycle, (d) => lifecycleWords(parseLifecycle(d))),
    row("Replication", settings?.replication, replicationWords),
    ["Owner", ownerName ?? (bucket.owner ? <span className="font-mono text-[12px]">{bucket.owner}</span> : <span className="text-warn">None: only a policy reaches it</span>)] as [string, ReactNode],
    ...(usage?.quota_bytes ? [["Quota", formatBytes(usage.quota_bytes)] as [string, ReactNode]] : []),
  ].filter((r): r is [string, ReactNode] => r !== null);

  const protection = protectionSentence(pool);
  const layout = layoutSentence(pool);
  const atRisk = (health?.atRisk ?? 0) > 0;

  const remove = async () => {
    if (!confirm(`Delete bucket ${bucket.name}? This can't be undone.`)) return;
    setDeleting(true);
    setDeleteErr("");
    try {
      await onDelete();
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <DetailsPanel
      label="Bucket details"
      overline="Bucket"
      title={bucket.name}
      sub={`${tenantName(bucket.tenant)} · created ${formatDate(bucket.created_at ?? usage?.created_at)}`}
      onClose={onClose}
    >
      <div className="px-4 pb-4 flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2">
          {[
            ["Stored", usage ? formatBytes(usage.logical_bytes) : "—"],
            ["Objects", usage ? formatCount(usage.objects) : "—"],
            ["On disk", usage ? formatBytes(usage.stored_bytes) : "—"],
          ].map(([k, val]) => (
            <div key={k} className="min-w-0">
              <Overline>{k}</Overline>
              <div className="text-[15px] font-semibold text-text tabular-nums truncate">{val}</div>
            </div>
          ))}
        </div>
        {usage && (usage.noncurrent_versions ?? 0) > 0 && (
          <p className="text-[12px] text-muted -mt-1">
            Plus {formatCount(usage.noncurrent_versions)} earlier version{usage.noncurrent_versions === 1 ? "" : "s"} ·{" "}
            {formatBytes(usage.noncurrent_bytes)}
          </p>
        )}
        <div className="flex gap-2">
          <LinkButton to={href} variant="primary" icon={<FolderOpen size={13} />} className="flex-1">
            Browse objects
          </LinkButton>
          <LinkButton to={`${href}?tab=settings`} icon={<Settings2 size={13} />} className="flex-1">
            Edit settings
          </LinkButton>
        </div>
      </div>

      <PanelSection title="Protection" action={<ProtectionHealth health={health} />}>
        <div className="flex gap-2.5 items-start">
          <span
            aria-hidden="true"
            className={`w-[30px] h-[30px] rounded-control inline-flex items-center justify-center shrink-0 ${
              atRisk ? "bg-err-soft text-err" : "bg-ok-soft text-ok"
            }`}
          >
            {atRisk ? <ShieldAlert size={16} /> : <ShieldCheck size={16} />}
          </span>
          <div className="min-w-0 text-[12.5px]">
            <div className="font-medium text-text">{protection ?? "Scheme not shown in this console"}</div>
            <div className="text-[12px] text-muted">
              Pool <span className="font-mono">{poolName(bucket.pool)}</span>
              {layout ? ` · ${layout}` : ""}
            </div>
          </div>
        </div>
      </PanelSection>

      <PanelSection title="Settings">
        <Kv rows={settingRows} />
        {refused.length > 0 && (
          <p className="text-[11.5px] text-muted">
            {refused.join(", ").replace(/, ([^,]*)$/, " and $1").replace(/^./, (c) => c.toUpperCase())} can't be read
            from the console yet: the gateway has no admin route for {refused.length === 1 ? "it" : "them"}.
          </p>
        )}
      </PanelSection>

      <PanelSection title="Who has access">
        <Kv
          rows={[
            ["Public access", <PublicBadge policy={policy} block={block} />],
            ["Bucket policy", policy === undefined ? <span className="text-muted">…</span> : policyWords(policy)],
          ]}
        />
        <div>
          <LinkButton to={`${href}?tab=access`} size="sm">
            Review access
          </LinkButton>
        </div>
      </PanelSection>

      <PanelSection>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-muted">Only an empty bucket can be deleted.</span>
          <DangerTextButton icon={<Trash2 size={13} />} disabled={deleting} onClick={() => void remove()}>
            Delete bucket
          </DangerTextButton>
        </div>
        {deleteErr && <p className="text-[12px] text-err">{deleteErr}</p>}
      </PanelSection>
    </DetailsPanel>
  );
}
