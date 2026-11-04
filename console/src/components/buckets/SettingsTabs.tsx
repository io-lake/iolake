import { useEffect, useState, type ReactNode } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { Badge, Banner, Button, Cell, Input, Select } from "../ui";
import type { PoolProtection } from "../../api/protection";
import { ProtectionHealth, PublicBadge } from "./BucketPanel";
import { CardFrame, DangerTextButton, Kv, SelectableRow, SettingCard, Th } from "./parts";
import type { BucketSettings } from "./hooks";
import {
  encryptionWords,
  formatBytes,
  formatCount,
  layoutSentence,
  lifecycleXml,
  lockWords,
  lockXml,
  parseLifecycle,
  parseLock,
  poolName,
  protectionSentence,
  readPolicy,
  REFUSED,
  replicationWords,
  ruleWords,
  versioningOf,
  writeS3Setting,
  type BucketInfo,
  type BucketUsage,
  type LifecycleRule,
  type LockConfig,
  type PolicyDoc,
  type PoolInfo,
  type PublicAccessBlock,
  type S3Setting,
  type UserInfo,
} from "./model";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/// What to say when a setting couldn't be read.
function Unreadable({ s, what }: { s: S3Setting | undefined; what: string }) {
  if (!s) return <p className="text-[12.5px] text-muted">Loading…</p>;
  if (s.state === "refused")
    return (
      <p className="text-[12.5px] text-muted">
        The console can't read this bucket's {what} yet: the gateway refuses the console's session on the S3 API and has
        no admin route for it. Use an S3 client to see or change it.
      </p>
    );
  if (s.state === "error") return <p className="text-[12.5px] text-err">Couldn't read the {what}: {s.message}</p>;
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

  const setVersioning = async (status: "Enabled" | "Suspended") => {
    setVerBusy(true);
    setVerErr("");
    try {
      await writeS3Setting(
        bucket.name,
        "versioning",
        "PUT",
        `<?xml version="1.0" encoding="UTF-8"?><VersioningConfiguration><Status>${status}</Status></VersioningConfiguration>`,
      );
      onBucketChanged();
    } catch (e) {
      setVerErr(errText(e));
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

  // When the gateway turned the session away on the S3 path, a versioning
  // change would be refused the same way, so it isn't offered.
  const s3Off = settings ? Object.values(settings).some((x) => x.state === "refused") : false;
  const enc = settings?.encryption;
  const repl = settings?.replication;

  return (
    <div className="grid gap-4 lg:grid-cols-2 items-start">
      <SettingCard
        title="Versioning"
        description="Keeps every version of an object, so an overwrite or a delete can be undone. Once on, it can be suspended but not turned off."
        action={
          v === "on" ? (
            <Button disabled={verBusy || s3Off} onClick={() => void setVersioning("Suspended")}>
              Suspend versioning
            </Button>
          ) : (
            <Button disabled={verBusy || s3Off} onClick={() => void setVersioning("Enabled")}>
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
        {s3Off && (
          <p className="text-[12px] text-muted">
            The console can't change versioning yet: the gateway refuses its session on the S3 API. Use an S3 client
            (<span className="font-mono text-[11.5px]">put-bucket-versioning</span>).
          </p>
        )}
        {verErr && <p className="text-[12px] text-err">{verErr}</p>}
      </SettingCard>

      <ObjectLockCard bucket={bucket.name} setting={settings?.lock} onSaved={reloadSettings} versioned={v === "on"} />

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

      <SettingCard title="Encryption and replication" description="Default encryption for new objects, and where this bucket copies them.">
        {enc?.state === "set" || enc?.state === "none" || repl?.state === "set" || repl?.state === "none" ? (
          <Kv
            rows={[
              ["Encryption", enc?.state === "set" ? encryptionWords(enc.doc) : enc?.state === "none" ? "Off" : "—"],
              ["Replication", repl?.state === "set" ? replicationWords(repl.doc) : repl?.state === "none" ? "Off" : "—"],
            ]}
          />
        ) : (
          <Unreadable s={enc} what="encryption and replication settings" />
        )}
      </SettingCard>

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

function ObjectLockCard({
  bucket,
  setting,
  versioned,
  onSaved,
}: {
  bucket: string;
  setting: S3Setting | undefined;
  versioned: boolean;
  onSaved: () => void;
}) {
  const readable = setting?.state === "set" || setting?.state === "none";
  const initial: LockConfig =
    setting?.state === "set" ? parseLock(setting.doc) : { enabled: false, mode: "COMPLIANCE", days: 0, years: 0 };
  const [draft, setDraft] = useState<LockConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const c = draft ?? initial;
  const set = (p: Partial<LockConfig>) => setDraft({ ...c, ...p });

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      await writeS3Setting(bucket, "object-lock", "PUT", lockXml(c));
      setDraft(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingCard
      title="Object lock"
      description="Stops objects from being deleted or overwritten for a set time (write once, read many). Needs versioning."
    >
      {!readable ? (
        <Unreadable s={setting} what="object lock" />
      ) : (
        <>
          <div className="flex items-center gap-2 text-[12.5px]">
            <span className="text-muted">Now:</span>
            <span className="text-text">{lockWords(initial)}</span>
          </div>
          <label className="inline-flex items-center gap-2 text-[12.5px] text-text">
            <input
              type="checkbox"
              role="switch"
              checked={c.enabled}
              onChange={(e) => set({ enabled: e.target.checked })}
              className="w-3.5 h-3.5 accent-accent"
            />
            Lock objects in this bucket
          </label>
          {c.enabled && (
            <div className="grid grid-cols-3 gap-3">
              <Select label="Mode" value={c.mode} onChange={(e) => set({ mode: e.target.value })}>
                <option value="COMPLIANCE">Compliance</option>
                <option value="GOVERNANCE">Governance</option>
              </Select>
              <Input label="Days" type="number" min={0} value={c.days} onChange={(e) => set({ days: parseInt(e.target.value, 10) || 0 })} />
              <Input label="Years" type="number" min={0} value={c.years} onChange={(e) => set({ years: parseInt(e.target.value, 10) || 0 })} />
            </div>
          )}
          {c.enabled && !versioned && <p className="text-[12px] text-warn">Turn on versioning first: object lock needs it.</p>}
          <div className="flex items-center gap-3">
            <Button icon={<Save size={13} />} disabled={busy || draft === null} onClick={() => void save()}>
              Save object lock
            </Button>
            {saved && <span className="text-[12px] text-ok">Object lock saved</span>}
          </div>
          {err && <p className="text-[12px] text-err">{err}</p>}
        </>
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

const EMPTY_RULE: LifecycleRule = {
  id: "",
  status: "Enabled",
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
  setting: S3Setting | undefined;
  onSaved: () => void;
}) {
  // Rules are written as a whole: a PUT replaces every rule. So editing is
  // only offered once the current rules have been read, or a save would
  // drop the ones the console couldn't see.
  const readable = setting?.state === "set" || setting?.state === "none";
  const rules = setting?.state === "set" ? parseLifecycle(setting.doc) : [];
  const [adding, setAdding] = useState<LifecycleRule | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const write = async (next: LifecycleRule[]) => {
    setBusy(true);
    setErr("");
    try {
      if (next.length === 0) await writeS3Setting(bucket, "lifecycle", "DELETE");
      else await writeS3Setting(bucket, "lifecycle", "PUT", lifecycleXml(next));
      onSaved();
      return true;
    } catch (e) {
      setErr(errText(e) === REFUSED ? REFUSED : `Couldn't save the rules: ${errText(e)}`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const num = (v: string) => Math.max(0, parseInt(v, 10) || 0);

  return (
    <div className="flex flex-col gap-4">
      <CardFrame label="Lifecycle rules" className="overflow-hidden">
        <div className="flex items-start justify-between gap-3 flex-wrap p-4 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-text">Lifecycle rules</h2>
            <p className="text-[12px] text-muted mt-0.5">
              Expire objects and earlier versions after a number of days, remove expired delete markers, and abort uploads that never finished.
            </p>
          </div>
          <Button icon={<Plus size={13} />} disabled={!readable || adding !== null} onClick={() => setAdding({ ...EMPTY_RULE })}>
            Add rule
          </Button>
        </div>

        {adding && (
          <form
            className="p-4 border-b border-border bg-surface-2 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!adding.id.trim() || rules.some((r) => r.id === adding.id.trim())) return;
              void write([...rules, { ...adding, id: adding.id.trim() }]).then((ok) => ok && setAdding(null));
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Input
                label="Rule name"
                value={adding.id}
                onChange={(e) => setAdding({ ...adding, id: e.target.value })}
                placeholder="expire-logs"
                error={rules.some((r) => r.id === adding.id.trim()) ? "A rule with this name exists." : undefined}
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
                onChange={(e) => setAdding({ ...adding, expiration_days: num(e.target.value) })}
                hint="0 leaves objects alone."
              />
              <Input
                label="Expire earlier versions after (days)"
                type="number"
                min={0}
                value={adding.noncurrent_days}
                onChange={(e) => setAdding({ ...adding, noncurrent_days: num(e.target.value) })}
              />
              <Input
                label="Abort unfinished uploads after (days)"
                type="number"
                min={0}
                value={adding.abort_days}
                onChange={(e) => setAdding({ ...adding, abort_days: num(e.target.value) })}
              />
              <label className="flex items-center gap-2 text-[12.5px] text-text self-center pt-4">
                <input
                  type="checkbox"
                  checked={adding.delete_markers}
                  onChange={(e) => setAdding({ ...adding, delete_markers: e.target.checked })}
                  className="w-3.5 h-3.5 accent-accent"
                />
                Remove expired delete markers
              </label>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || !adding.id.trim()}>
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
            <Unreadable s={setting} what="lifecycle rules" />
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
                    <Cell className="font-mono">{r.prefix || <span className="font-sans text-muted">Every key</span>}</Cell>
                    <Cell>{ruleWords(r)}</Cell>
                    <Cell>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        aria-label={`${r.status === "Enabled" ? "Turn off" : "Turn on"} rule ${r.id}`}
                        onClick={() =>
                          void write(rules.map((x) => (x.id === r.id ? { ...x, status: x.status === "Enabled" ? "Disabled" : "Enabled" } : x)))
                        }
                      >
                        {r.status === "Enabled" ? <Badge kind="ok">On</Badge> : <Badge>Off</Badge>}
                      </Button>
                    </Cell>
                    <Cell align="right">
                      <DangerTextButton
                        disabled={busy}
                        label={`Delete rule ${r.id}`}
                        icon={<Trash2 size={13} />}
                        onClick={() => {
                          if (confirm(`Delete lifecycle rule ${r.id}?`)) void write(rules.filter((x) => x.id !== r.id));
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
