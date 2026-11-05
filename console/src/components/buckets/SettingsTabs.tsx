import { useEffect, useState, type ReactNode } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { Badge, Banner, Button, Cell, Input, Select } from "../ui";
import type { PoolProtection } from "../../api/protection";
import { ProtectionHealth, PublicBadge } from "./BucketPanel";
import { CardFrame, DangerTextButton, Kv, SelectableRow, SettingCard, Th } from "./parts";
import type { BucketSettings } from "./hooks";
import {
  changeLifecycle,
  encryptionSentence,
  encryptionWords,
  formatBytes,
  formatCount,
  layoutSentence,
  lifecycleRule,
  lifecycleRuleDoc,
  lockDoc,
  lockFromDoc,
  lockFromListing,
  lockSentence,
  lockWords,
  poolName,
  protectionSentence,
  readPolicy,
  replicationRule,
  SettingError,
  versioningOf,
  writeSetting,
  type BucketInfo,
  type BucketUsage,
  type EncryptionDoc,
  type LifecycleDoc,
  type LifecycleDraft,
  type LockConfig,
  type LockDoc,
  type PolicyDoc,
  type PoolInfo,
  type PublicAccessBlock,
  type ReplicationDoc,
  type Setting,
  type UserInfo,
} from "./model";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/// What a setting shows while it loads or when it couldn't be read; `null`
/// once it has a value to show.
function NotYet({ s }: { s: Setting<unknown> | undefined }) {
  if (!s) return <p className="text-[12.5px] text-muted">Loading…</p>;
  if (s.state === "error") return <p className="text-[12.5px] text-err">{s.message}</p>;
  return null;
}

// ---- Settings -------------------------------------------------------------

export function SettingsTab({
  bucket,
  usage,
  pool,
  health,
  settings,
  reloadSettings,
  onBucketChanged,
  onDelete,
}: {
  bucket: BucketInfo;
  usage: BucketUsage | undefined;
  pool: PoolInfo | undefined;
  health: PoolProtection | undefined;
  settings: BucketSettings | null;
  reloadSettings: () => void;
  onBucketChanged: () => void;
  onDelete: () => Promise<void>;
}) {
  const v = versioningOf(bucket.versioning);
  const [verBusy, setVerBusy] = useState(false);
  const [verErr, setVerErr] = useState("");
  const [delErr, setDelErr] = useState("");
  // The lock's own read is the freshest; the listing answers until it's in.
  const locked =
    settings?.lock.state === "set" ? lockFromDoc(settings.lock.doc).enabled : lockFromListing(bucket.object_lock).enabled;

  const setVersioning = async (status: "Enabled" | "Suspended") => {
    setVerBusy(true);
    setVerErr("");
    try {
      await writeSetting(bucket.name, "versioning", "PUT", { Status: status });
      onBucketChanged();
    } catch (e) {
      if (e instanceof SettingError && e.status === 409 && status === "Suspended") {
        setVerErr(
          "Versioning can't be suspended on this bucket: it has object lock, which keeps every version until its retention ends. Object lock can't be turned off, so versioning stays on.",
        );
        onBucketChanged();
        reloadSettings();
      } else setVerErr(`Couldn't ${status === "Enabled" ? "turn on" : "suspend"} versioning. ${errText(e)}`);
    } finally {
      setVerBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete bucket ${bucket.name}? This can't be undone.`)) return;
    setDelErr("");
    try {
      await onDelete();
    } catch (e) {
      setDelErr(errText(e));
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2 items-start">
      <SettingCard
        title="Versioning"
        description="Keeps every version of an object, so an overwrite or a delete can be undone. Once on, it can be suspended but not turned off."
        action={
          v === "on" ? (
            <Button disabled={verBusy || locked} onClick={() => void setVersioning("Suspended")}>
              Suspend versioning
            </Button>
          ) : (
            <Button disabled={verBusy} onClick={() => void setVersioning("Enabled")}>
              {v === "suspended" ? "Resume versioning" : "Turn on versioning"}
            </Button>
          )
        }
      >
        <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
          {v === "on" ? <Badge kind="ok">On</Badge> : v === "suspended" ? <Badge kind="warn">Suspended</Badge> : <Badge>Off</Badge>}
          <span className="text-muted">
            {v === "suspended"
              ? "New writes replace the current object; versions made before stay."
              : v === "on"
                ? usage
                  ? `${formatCount(usage.noncurrent_versions ?? 0)} earlier version${usage.noncurrent_versions === 1 ? "" : "s"} kept · ${formatBytes(usage.noncurrent_bytes ?? 0)}`
                  : "Earlier versions are kept."
                : "An overwrite replaces the object."}
          </span>
        </div>
        {v === "on" && locked && !verErr && (
          <p className="text-[12px] text-muted">
            Object lock keeps versioning on: a locked bucket must keep every version, so it can't be suspended.
          </p>
        )}
        {verErr && <p className="text-[12px] text-err">{verErr}</p>}
      </SettingCard>

      <ObjectLockCard bucket={bucket.name} setting={settings?.lock} versioned={v === "on"} onSaved={() => (reloadSettings(), onBucketChanged())} />

      <SettingCard title="Protection" description="How this bucket's objects are stored, set by its pool.">
        <Kv
          rows={[
            ["Pool", <span className="font-mono">{poolName(bucket.pool)}</span>],
            ["Scheme", protectionSentence(pool) ?? <span className="text-muted">Not shown in this console</span>],
            ...(layoutSentence(pool) ? [["Layout", layoutSentence(pool)] as [string, ReactNode]] : []),
            ...(health && health.total > 0
              ? [["Right now", <ProtectionHealth health={health} />] as [string, ReactNode]]
              : []),
            ...(usage ? [["On disk", `${formatBytes(usage.stored_bytes)} for ${formatBytes(usage.logical_bytes)} of data`] as [string, ReactNode]] : []),
          ]}
        />
      </SettingCard>

      <EncryptionCard setting={settings?.encryption} />

      <ReplicationCard setting={settings?.replication} />

      <SettingCard
        title="Delete bucket"
        description="Removes the bucket and its name. Only an empty bucket can be deleted: delete its objects first."
        action={
          <Button variant="danger" icon={<Trash2 size={13} />} onClick={() => void remove()}>
            Delete bucket
          </Button>
        }
      >
        {delErr && <p className="text-[12px] text-err">{delErr}</p>}
      </SettingCard>
    </div>
  );
}

/// The default retention as the form edits it: a period in one unit, as S3
/// takes exactly one of days and years.
interface RetentionDraft {
  mode: LockConfig["mode"];
  period: number;
  unit: "days" | "years";
}

function retentionOf(c: LockConfig): RetentionDraft {
  return { mode: c.mode, period: c.years || c.days || 0, unit: c.years ? "years" : "days" };
}

function ObjectLockCard({
  bucket,
  setting,
  versioned,
  onSaved,
}: {
  bucket: string;
  setting: Setting<LockDoc> | undefined;
  versioned: boolean;
  onSaved: () => void;
}) {
  const current = setting?.state === "set" ? lockFromDoc(setting.doc) : lockFromDoc(undefined);
  const [draft, setDraft] = useState<RetentionDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState("");
  const d = draft ?? retentionOf(current);
  const set = (p: Partial<RetentionDraft>) => setDraft({ ...d, ...p });
  const periodErr = d.mode && d.period < 1 ? "Enter 1 or more." : undefined;
  const turningOn = !current.enabled;

  const save = async () => {
    if (
      turningOn &&
      !confirm(
        `Turn on object lock for ${bucket}? It can't be turned off again, and versioning can't be suspended once it's on.`,
      )
    )
      return;
    setBusy(true);
    setErr("");
    setSaved("");
    const next: LockConfig = {
      enabled: true,
      mode: d.mode,
      days: d.mode && d.unit === "days" ? d.period : 0,
      years: d.mode && d.unit === "years" ? d.period : 0,
    };
    try {
      await writeSetting(bucket, "object-lock", "PUT", lockDoc(next));
      setDraft(null);
      setSaved(turningOn ? "Object lock is on" : "Default retention saved");
      setTimeout(() => setSaved(""), 2500);
      onSaved();
    } catch (e) {
      setErr(
        e instanceof SettingError && e.status === 409
          ? "Turn on versioning first: object lock needs every version kept."
          : `Couldn't save object lock. ${errText(e)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingCard
      title="Object lock"
      description="Stops objects from being deleted or overwritten for a set time (write once, read many). Needs versioning, and can't be turned off once on."
    >
      {!setting || setting.state === "error" ? (
        <NotYet s={setting} />
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
            {current.enabled ? <Badge kind="ok">On</Badge> : <Badge>Off</Badge>}
            {current.enabled && <span className="text-text">{lockWords(current)}</span>}
          </div>
          <p className="text-[12.5px] text-muted -mt-1">{lockSentence(current)}</p>
          {turningOn && !versioned ? (
            <p className="text-[12px] text-muted">Object lock can be turned on once versioning is on: it needs every version kept.</p>
          ) : (
            <form
              className="flex flex-col gap-3 pt-1 border-t border-border"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 pt-2">
                <Select label="Default retention" value={d.mode} onChange={(e) => set({ mode: e.target.value as LockConfig["mode"] })}>
                  <option value="">None</option>
                  <option value="GOVERNANCE">Governance</option>
                  <option value="COMPLIANCE">Compliance</option>
                </Select>
                <Input
                  label="Keep for"
                  type="number"
                  min={1}
                  disabled={!d.mode}
                  value={d.mode ? d.period : ""}
                  error={periodErr}
                  onChange={(e) => set({ period: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                />
                <Select label="Unit" disabled={!d.mode} value={d.unit} onChange={(e) => set({ unit: e.target.value as RetentionDraft["unit"] })}>
                  <option value="days">Days</option>
                  <option value="years">Years</option>
                </Select>
              </div>
              {d.mode === "COMPLIANCE" && (
                <p className="text-[12px] text-warn -mt-1">
                  In compliance mode no one can delete a new object until its time is up, an admin included.
                </p>
              )}
              <div className="flex items-center gap-3 flex-wrap">
                <Button
                  type="submit"
                  variant={turningOn ? "primary" : "secondary"}
                  icon={turningOn ? undefined : <Save size={13} />}
                  disabled={busy || !!periodErr || (!turningOn && draft === null)}
                >
                  {turningOn ? "Turn on object lock" : "Save default retention"}
                </Button>
                {!turningOn && draft !== null && (
                  <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                    Discard changes
                  </Button>
                )}
                {saved && <span className="text-[12px] text-ok">{saved}</span>}
              </div>
            </form>
          )}
          {err && <p className="text-[12px] text-err">{err}</p>}
        </>
      )}
    </SettingCard>
  );
}

function EncryptionCard({ setting }: { setting: Setting<EncryptionDoc> | undefined }) {
  const doc = setting?.state === "set" ? setting.doc : undefined;
  const on = !!doc?.Rule?.[0]?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm;
  return (
    <SettingCard title="Default encryption" description="How objects written to this bucket are encrypted when the upload doesn't say.">
      {!setting || setting.state === "error" ? (
        <NotYet s={setting} />
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
            {on ? <Badge kind="ok">On</Badge> : <Badge>Off</Badge>}
            {on && <span className="text-text">{encryptionWords(doc)}</span>}
          </div>
          <p className="text-[12.5px] text-muted -mt-1">{encryptionSentence(doc)}</p>
        </>
      )}
    </SettingCard>
  );
}

function ReplicationCard({ setting }: { setting: Setting<ReplicationDoc> | undefined }) {
  const rules = setting?.state === "set" ? (setting.doc.Rule ?? []).map(replicationRule) : [];
  const sorted = [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return (
    <SettingCard title="Replication" description="Copies new objects from this bucket to another IOLake cluster, by rule.">
      {!setting || setting.state === "error" ? (
        <NotYet s={setting} />
      ) : rules.length === 0 ? (
        <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
          <Badge>Off</Badge>
          <span className="text-muted">This bucket's objects aren't copied anywhere.</span>
        </div>
      ) : (
        <ul className="flex flex-col -my-1" aria-label="Replication rules">
          {sorted.map((r) => (
            <li key={r.id} className="py-2 border-t border-border first:border-t-0 flex flex-col gap-0.5">
              <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
                {r.enabled ? <Badge kind="ok">On</Badge> : <Badge>Off</Badge>}
                <span className="font-mono text-text">{r.id}</span>
                {rules.length > 1 && r.priority !== undefined && (
                  <span className="text-[11.5px] text-muted">priority {r.priority}</span>
                )}
              </div>
              <p className="text-[12.5px] text-text">
                {r.scope} {r.enabled ? "are copied" : "would be copied"} to{" "}
                {r.target ? <span className="font-mono">{r.target}</span> : "a target the rule doesn't name"}.
              </p>
              <p className="text-[12px] text-muted">
                {r.deletes ? "Deletes are copied too." : "Deletes aren't copied: an object deleted here stays at the target."}
              </p>
            </li>
          ))}
        </ul>
      )}
    </SettingCard>
  );
}

// ---- Access ---------------------------------------------------------------

const POLICY_TEMPLATE = (bucket: string) =>
  JSON.stringify(
    {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: ["arn:objectio:iam::user/USER"] },
          Action: ["s3:GetObject", "s3:ListBucket"],
          Resource: [`arn:obio:s3:::${bucket}`, `arn:obio:s3:::${bucket}/*`],
        },
      ],
    },
    null,
    2,
  );

export function AccessTab({
  bucket,
  users,
  policy,
  block,
  onOwnerChanged,
  onPolicyChanged,
}: {
  bucket: BucketInfo;
  users: UserInfo[];
  /// `undefined` while loading.
  policy: PolicyDoc | null | undefined;
  block: PublicAccessBlock | null;
  onOwnerChanged: () => void;
  onPolicyChanged: () => void;
}) {
  const [owner, setOwner] = useState("");
  const [ownerMsg, setOwnerMsg] = useState("");
  const [ownerErr, setOwnerErr] = useState("");
  const ownerUser = users.find((u) => u.user_id === bucket.owner);
  const hasOwner = !!bucket.owner && bucket.owner !== "default";

  const saveOwner = async () => {
    setOwnerMsg("");
    setOwnerErr("");
    const r = await fetch(`/_admin/buckets/${encodeURIComponent(bucket.name)}/owner`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner }),
    });
    if (r.ok) {
      setOwnerMsg("Owner changed");
      setOwner("");
      onOwnerChanged();
    } else {
      setOwnerErr((await r.text()) || `${r.status} ${r.statusText}`);
    }
  };

  const p = policy === undefined ? null : readPolicy(policy);

  return (
    <div className="grid gap-4 lg:grid-cols-2 items-start">
      <SettingCard
        title="Owner"
        description="The owner reaches this bucket when no policy says otherwise. Everyone else needs an IAM policy or a statement in the bucket policy."
      >
        {hasOwner ? (
          <Kv
            rows={[
              [
                "Owner",
                ownerUser ? (
                  <>
                    {ownerUser.display_name} <span className="font-mono text-[11.5px] text-muted">{bucket.owner}</span>
                  </>
                ) : (
                  <span className="font-mono text-[12px]">{bucket.owner}</span>
                ),
              ],
            ]}
          />
        ) : (
          <Banner kind="warn" title="This bucket has no owner">
            Only a policy, or a system admin, reaches it. Pick an owner below.
          </Banner>
        )}
        <form
          className="flex gap-2 items-end flex-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            void saveOwner();
          }}
        >
          <div className="flex-[1_1_220px]">
            <Select label="Change owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Pick a user…</option>
              {users.map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.display_name} ({u.user_id.slice(0, 8)})
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" icon={<Save size={13} />} disabled={!owner}>
            Save owner
          </Button>
        </form>
        {ownerMsg && <p className="text-[12px] text-ok">{ownerMsg}</p>}
        {ownerErr && <p className="text-[12px] text-err">{ownerErr}</p>}
      </SettingCard>

      <SettingCard
        title="Public access"
        description="Whether someone without credentials can reach this bucket. Only the bucket policy can make it public."
      >
        <Kv
          rows={[
            ["Now", <PublicBadge policy={policy} block={block} />],
            [
              "Bucket policy",
              p ? (p.public === "private" ? "Grants nothing to anyone without credentials" : p.public === "read" ? "Lets anyone read" : "Lets anyone read and write") : "…",
            ],
            [
              "Cluster block",
              block
                ? block.RestrictPublicBuckets
                  ? "On: public policies grant nothing to anonymous callers"
                  : block.BlockPublicPolicy
                    ? "New public policies are refused"
                    : "Off"
                : <span className="text-muted">Not shown in this console</span>,
            ],
          ]}
        />
      </SettingCard>

      <div className="lg:col-span-2">
        <PolicyCard bucket={bucket.name} policy={policy} onSaved={onPolicyChanged} />
      </div>
    </div>
  );
}

function PolicyCard({
  bucket,
  policy,
  onSaved,
}: {
  bucket: string;
  policy: PolicyDoc | null | undefined;
  onSaved: () => void;
}) {
  const [named, setNamed] = useState<{ name: string; policy: PolicyDoc }[]>([]);
  const [pick, setPick] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/_admin/policies")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { policies?: { name: string; policy: PolicyDoc }[] }) => setNamed(d.policies ?? []))
      .catch(() => setNamed([]));
  }, []);

  const saved = policy ? JSON.stringify(policy, null, 2) : "";
  const text = draft ?? saved;
  let parseErr = "";
  if (text.trim()) {
    try {
      JSON.parse(text);
    } catch (e) {
      parseErr = `Not valid JSON: ${errText(e)}`;
    }
  }

  // A named policy's statements, scoped to this bucket and added to the
  // bucket policy being edited.
  const attach = () => {
    const np = named.find((x) => x.name === pick);
    if (!np) return;
    let doc: PolicyDoc;
    try {
      doc = text.trim() ? (JSON.parse(text) as PolicyDoc) : { Version: "2012-10-17", Statement: [] };
    } catch {
      doc = { Version: "2012-10-17", Statement: [] };
    }
    const added = (np.policy.Statement ?? []).map((s) => ({
      ...s,
      Resource: [`arn:obio:s3:::${bucket}`, `arn:obio:s3:::${bucket}/*`],
    }));
    doc.Statement = [...(doc.Statement ?? []), ...added];
    setDraft(JSON.stringify(doc, null, 2));
    setPick("");
  };

  const save = async (remove: boolean) => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const url = `/_admin/buckets/${encodeURIComponent(bucket)}/policy`;
      const r = remove || !text.trim()
        ? await fetch(url, { method: "DELETE" })
        : await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: text });
      if (!r.ok) throw new Error((await r.text()) || `${r.status} ${r.statusText}`);
      setDraft(null);
      setMsg(remove || !text.trim() ? "Bucket policy removed" : "Bucket policy saved");
      onSaved();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingCard
      title="Bucket policy"
      description="Statements that grant or deny access to this bucket, on top of the IAM policies attached to users and groups."
    >
      {policy === undefined ? (
        <p className="text-[12.5px] text-muted">Loading…</p>
      ) : (
        <>
          <div className="flex gap-2 items-end flex-wrap">
            <div className="flex-[1_1_260px]">
              <Select label="Add statements from a named policy" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Pick a policy…</option>
                {named.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button icon={<Plus size={13} />} disabled={!pick} onClick={attach}>
              Add statements
            </Button>
            {!text.trim() && (
              <Button variant="ghost" onClick={() => setDraft(POLICY_TEMPLATE(bucket))}>
                Start from an example
              </Button>
            )}
          </div>
          <div>
            <label htmlFor="bucket-policy" className="block text-[11px] font-semibold text-text-2 mb-1">
              Policy document (JSON)
            </label>
            <textarea
              id="bucket-policy"
              value={text}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              rows={Math.min(22, Math.max(6, text.split("\n").length + 1))}
              placeholder="No bucket policy. Add statements from a named policy, or write one here."
              className="w-full rounded-control border border-border-strong bg-code-bg text-code-fg font-mono text-[12px] leading-[18px] p-3
                focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft placeholder:text-code-fg/60"
            />
            {parseErr && <p className="mt-1 text-[11px] text-err">{parseErr}</p>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button icon={<Save size={13} />} disabled={busy || draft === null || !!parseErr} onClick={() => void save(false)}>
              {text.trim() ? "Save policy" : "Save, removing the policy"}
            </Button>
            {draft !== null && (
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Discard changes
              </Button>
            )}
            {policy && draft === null && (
              <DangerTextButton icon={<Trash2 size={13} />} disabled={busy} onClick={() => void save(true)}>
                Remove policy
              </DangerTextButton>
            )}
            {msg && <span className="text-[12px] text-ok">{msg}</span>}
          </div>
          {err && <p className="text-[12px] text-err">{err}</p>}
        </>
      )}
    </SettingCard>
  );
}

// ---- Lifecycle ------------------------------------------------------------

const EMPTY_RULE: LifecycleDraft = {
  id: "",
  prefix: "",
  expiration_days: 0,
  noncurrent_days: 0,
  abort_days: 0,
  delete_markers: false,
};

export function LifecycleTab({
  bucket,
  setting,
  onSaved,
}: {
  bucket: string;
  setting: Setting<LifecycleDoc> | undefined;
  onSaved: () => void;
}) {
  // A PUT replaces every rule, so each change reads the rules again and
  // edits those (`changeLifecycle`). Editing is offered only once they have
  // been read here too, so the page never shows a list it couldn't save.
  const readable = setting?.state === "set" || setting?.state === "none";
  const rules = setting?.state === "set" ? (setting.doc.Rule ?? []).map(lifecycleRule) : [];
  const [adding, setAdding] = useState<LifecycleDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const change = async (fn: Parameters<typeof changeLifecycle>[1], failed: string, done: string) => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await changeLifecycle(bucket, fn);
      setMsg(done);
      setTimeout(() => setMsg(""), 2500);
      return true;
    } catch (e) {
      setErr(`${failed} ${errText(e)}`);
      return false;
    } finally {
      setBusy(false);
      onSaved();
    }
  };

  const add = (draft: LifecycleDraft) => {
    const id = draft.id.trim();
    return change(
      (now) => {
        if (now.some((r) => r.ID === id)) throw new Error(`Someone else has just added a rule named ${id}. Pick another name.`);
        return [...now, lifecycleRuleDoc(draft)];
      },
      "Couldn't add the rule.",
      `Rule ${id} added`,
    );
  };

  const turn = (id: string, on: boolean) =>
    change(
      (now) => {
        if (!now.some((r) => r.ID === id)) throw new Error(`Rule ${id} isn't there any more: someone else has removed it.`);
        return now.map((r) => (r.ID === id ? { ...r, Status: on ? "Enabled" : "Disabled" } : r));
      },
      `Couldn't turn ${on ? "on" : "off"} rule ${id}.`,
      `Rule ${id} turned ${on ? "on" : "off"}`,
    );

  const remove = (id: string) =>
    change((now) => now.filter((r) => r.ID !== id), `Couldn't delete rule ${id}.`, `Rule ${id} deleted`);

  const num = (v: string) => Math.max(0, parseInt(v, 10) || 0);
  const id = adding?.id.trim() ?? "";
  const taken = !!adding && rules.some((r) => r.id === id);
  const noAction =
    !!adding && !adding.expiration_days && !adding.noncurrent_days && !adding.abort_days && !adding.delete_markers;

  return (
    <div className="flex flex-col gap-4">
      <CardFrame label="Lifecycle rules" className="overflow-hidden">
        <div className="flex items-start justify-between gap-3 flex-wrap p-4 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-text">Lifecycle rules</h2>
            <p className="text-[12px] text-muted mt-0.5">
              Expire objects and earlier versions after a number of days, remove delete markers left with no versions, and abort uploads that never finished.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {msg && <span className="text-[12px] text-ok">{msg}</span>}
            <Button icon={<Plus size={13} />} disabled={!readable || adding !== null} onClick={() => setAdding({ ...EMPTY_RULE })}>
              Add rule
            </Button>
          </div>
        </div>

        {adding && (
          <form
            aria-label="New lifecycle rule"
            className="p-4 border-b border-border bg-surface-2 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!id || taken || noAction) return;
              void add(adding).then((ok) => ok && setAdding(null));
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Input
                label="Rule name"
                value={adding.id}
                onChange={(e) => setAdding({ ...adding, id: e.target.value })}
                placeholder="expire-logs"
                error={taken ? "A rule with this name exists." : undefined}
                autoFocus
              />
              <Input
                label="Only keys starting with"
                value={adding.prefix}
                onChange={(e) => setAdding({ ...adding, prefix: e.target.value })}
                placeholder="logs/ (empty: every key)"
                className="font-mono"
              />
              <Input
                label="Expire objects after (days)"
                type="number"
                min={0}
                value={adding.expiration_days}
                onChange={(e) => {
                  const days = num(e.target.value);
                  setAdding({ ...adding, expiration_days: days, delete_markers: days > 0 ? false : adding.delete_markers });
                }}
                hint="0 leaves objects alone."
              />
              <Input
                label="Expire earlier versions after (days)"
                type="number"
                min={0}
                value={adding.noncurrent_days}
                onChange={(e) => setAdding({ ...adding, noncurrent_days: num(e.target.value) })}
                hint="Counted from when a newer version replaced it."
              />
              <Input
                label="Abort unfinished uploads after (days)"
                type="number"
                min={0}
                value={adding.abort_days}
                onChange={(e) => setAdding({ ...adding, abort_days: num(e.target.value) })}
              />
              <div className="self-center pt-4">
                <label className="flex items-center gap-2 text-[12.5px] text-text has-[:disabled]:text-muted">
                  <input
                    type="checkbox"
                    checked={adding.delete_markers}
                    disabled={adding.expiration_days > 0}
                    onChange={(e) => setAdding({ ...adding, delete_markers: e.target.checked })}
                    className="w-3.5 h-3.5 accent-accent"
                  />
                  Remove delete markers with no versions left
                </label>
                {adding.expiration_days > 0 && (
                  <p className="mt-1 text-[11px] text-muted">Not with an expiry: expiring objects already removes these.</p>
                )}
              </div>
            </div>
            {noAction && id && <p className="text-[12px] text-muted">Give the rule something to do: one of the days, or the delete markers.</p>}
            <div className="flex gap-2">
              <Button type="submit" variant="primary" disabled={busy || !id || taken || noAction}>
                Add rule
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAdding(null)}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {!readable ? (
          <div className="p-4">
            <NotYet s={setting} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[640px]">
              <thead>
                <tr>
                  <Th>Rule</Th>
                  <Th>Applies to</Th>
                  <Th>What it does</Th>
                  <Th>Status</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rules.length === 0 && (
                  <tr className="border-t border-border">
                    <td colSpan={5} className="px-3.5 py-8 text-center text-[12.5px] text-muted">
                      No lifecycle rules. Objects stay until someone deletes them.
                    </td>
                  </tr>
                )}
                {rules.map((r) => (
                  <SelectableRow key={r.id} selected={false}>
                    <Cell className="font-mono text-text">{r.id}</Cell>
                    <Cell>
                      {r.prefix ? <span className="font-mono">{r.prefix}</span> : <span className="text-muted">Every key</span>}
                      {r.conditions.length > 0 && <span className="text-muted"> · {r.conditions.join(" · ")}</span>}
                    </Cell>
                    <Cell>{r.actions}</Cell>
                    <Cell>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        aria-label={`${r.enabled ? "Turn off" : "Turn on"} rule ${r.id}`}
                        title={r.enabled ? "Turn off" : "Turn on"}
                        onClick={() => void turn(r.id, !r.enabled)}
                      >
                        {r.enabled ? <Badge kind="ok">On</Badge> : <Badge>Off</Badge>}
                      </Button>
                    </Cell>
                    <Cell align="right">
                      <DangerTextButton
                        disabled={busy}
                        label={`Delete rule ${r.id}`}
                        icon={<Trash2 size={13} />}
                        onClick={() => {
                          if (confirm(`Delete lifecycle rule ${r.id}?`)) void remove(r.id);
                        }}
                      />
                    </Cell>
                  </SelectableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {err && <p className="px-4 py-2.5 border-t border-border text-[12px] text-err">{err}</p>}
      </CardFrame>
    </div>
  );
}
