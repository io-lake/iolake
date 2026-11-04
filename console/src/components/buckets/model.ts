/// What the Buckets pages read from the gateway, and how they put it into
/// words. Everything here comes from the admin API (`/_admin/*`, which takes
/// the console's session), the settings S3 keeps as bucket sub-resources
/// included: their admin routes take and answer S3's documents as JSON.

// ---- shapes ---------------------------------------------------------------

export interface BucketInfo {
  name: string;
  created_at?: number;
  owner?: string;
  /// 0 = never turned on, 1 = enabled, 2 = suspended.
  versioning?: number;
  object_lock?: BucketLock;
  /// Empty = the default pool.
  pool?: string;
  /// Empty = the system tenant.
  tenant?: string;
}

/// A bucket's object lock as the listing gives it: `days` or `years`.
export interface BucketLock {
  enabled: boolean;
  default_retention?: { mode: string; days?: number; years?: number };
}

export interface PoolInfo {
  name: string;
  /// 0 = Reed-Solomon (MDS), 1 = LRC, 2 = replication.
  ec_type?: number;
  ec_k?: number;
  ec_m?: number;
  ec_local_parity?: number;
  ec_global_parity?: number;
  replication_count?: number;
  failure_domain?: string;
  description?: string;
}

export interface BucketUsage {
  bucket: string;
  tenant?: string;
  owner?: string;
  pool?: string;
  created_at?: number;
  objects: number;
  logical_bytes: number;
  stored_bytes: number;
  noncurrent_versions?: number;
  noncurrent_bytes?: number;
  last_modified?: number;
  quota_bytes?: number;
  quota_objects?: number;
}

export interface UsageReport {
  updated_at: number;
  buckets: BucketUsage[];
}

export interface UserInfo {
  user_id: string;
  display_name: string;
}

export interface PolicyStatement {
  Sid?: string;
  Effect?: string;
  Action?: string | string[];
  Resource?: string | string[];
  Principal?: unknown;
}

export interface PolicyDoc {
  Version?: string;
  Statement?: PolicyStatement[];
}

export interface PublicAccessBlock {
  BlockPublicAcls?: boolean;
  BlockPublicPolicy?: boolean;
  IgnorePublicAcls?: boolean;
  RestrictPublicBuckets?: boolean;
}

export interface S3Object {
  key: string;
  size: number;
  last_modified: number;
  etag: string;
}

// ---- reads ----------------------------------------------------------------

async function json<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()) || r.statusText}`);
  return r.json() as Promise<T>;
}

export const loadBuckets = () =>
  json<{ buckets?: BucketInfo[] }>("/_admin/buckets").then((d) => d.buckets ?? []);

/// System admins only; a tenant's console gets 403 and shows the pool by
/// name without its scheme.
export const loadPools = () =>
  json<PoolInfo[] | { pools: PoolInfo[] }>("/_admin/pools").then((d) =>
    Array.isArray(d) ? d : (d.pools ?? []),
  );

/// Gathered by the gateway every few seconds from the OSDs; 503 until the
/// first pass is in.
export const loadUsage = () => json<UsageReport>("/_admin/usage");

export const loadUsers = () =>
  json<UserInfo[] | { users: UserInfo[] }>("/_admin/users").then((d) =>
    Array.isArray(d) ? d : (d.users ?? []),
  );

export const loadPublicAccessBlock = () =>
  json<PublicAccessBlock>("/_admin/public-access-block");

export async function loadBucketPolicy(bucket: string): Promise<PolicyDoc | null> {
  const d = await json<{ has_policy?: boolean; policy?: PolicyDoc | null }>(
    `/_admin/buckets/${encodeURIComponent(bucket)}/policy`,
  );
  return d.has_policy && d.policy ? d.policy : null;
}

/// Run `fn` over `items` with at most `limit` in flight, so a long bucket
/// list doesn't open a hundred requests at once.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/// A bucket setting S3 keeps as a sub-resource, read from its admin route
/// (`/_admin/buckets/{name}/{setting}`), which answers S3's document as
/// JSON with S3's element names.
/// - `set`: the bucket has one; `doc` is the document.
/// - `none`: the bucket has none (404 with S3's "not configured" code).
/// - `error`: anything else, as a sentence to show.
export type Setting<T> = { state: "set"; doc: T } | { state: "none" } | { state: "error"; message: string };

export type SettingName = "versioning" | "object-lock" | "encryption" | "lifecycle" | "replication";

/// Each setting as a sentence names it.
const SETTING_WORDS: Record<SettingName, string> = {
  versioning: "versioning",
  "object-lock": "object lock",
  encryption: "default encryption",
  lifecycle: "lifecycle rules",
  replication: "replication rules",
};

/// The 404 codes that mean the bucket has no such setting, as opposed to
/// `NoSuchBucket`.
const NOT_CONFIGURED = new Set([
  "ObjectLockConfigurationNotFoundError",
  "ServerSideEncryptionConfigurationNotFoundError",
  "NoSuchLifecycleConfiguration",
  "ReplicationConfigurationNotFoundError",
]);

/// A refused read or write of a setting: the sentence to show, with the
/// status and S3's code so a caller can say more for one it expects (a 409).
export class SettingError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  constructor(message: string, status: number, code: string, detail = "") {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

const UNREACHABLE = "The console couldn't reach the gateway. Check the connection and try again.";

/// "Days must be positive" → "Days must be positive."
const period = (s: string) => (s && !/[.!?]$/.test(s) ? `${s}.` : s);

function settingUrl(bucket: string, name: SettingName) {
  return `/_admin/buckets/${encodeURIComponent(bucket)}/${name}`;
}

async function refusal(r: Response, name: SettingName, writing: boolean): Promise<SettingError> {
  let code = "";
  let detail = "";
  try {
    const d = (await r.json()) as { code?: string; message?: string };
    code = d.code ?? "";
    detail = d.message ?? "";
  } catch {
    // Not JSON: a proxy's page, or nothing.
  }
  const what = SETTING_WORDS[name];
  const say = (m: string) => new SettingError(m, r.status, code, detail);
  if (r.status === 401) return say("Your session has ended. Sign in again.");
  if (r.status === 403)
    return say(
      `Only a system admin or an admin of this bucket's tenant can ${writing ? "change" : "see"} its ${what}.`,
    );
  if (r.status === 404) return say("This bucket no longer exists.");
  if (code === "MalformedJSON")
    return say(`The gateway couldn't read the ${what} the console sent. ${period(detail)}`.trim());
  if (r.status === 400) return say(`The gateway refused the ${what}: ${period(detail) || "it gave no reason."}`);
  if (r.status === 409) return say(period(detail) || `The bucket's state doesn't allow this change to its ${what}.`);
  return say(
    `The gateway couldn't ${writing ? "save" : "read"} the ${what} (${r.status}${detail ? `: ${detail}` : ""}). Try again in a moment.`,
  );
}

export async function readSetting<T>(bucket: string, name: SettingName): Promise<Setting<T>> {
  let r: Response;
  try {
    r = await fetch(settingUrl(bucket, name));
  } catch {
    return { state: "error", message: UNREACHABLE };
  }
  if (r.ok) {
    try {
      return { state: "set", doc: (await r.json()) as T };
    } catch {
      return { state: "error", message: `The gateway's answer for the ${SETTING_WORDS[name]} wasn't JSON.` };
    }
  }
  if (r.status === 404) {
    const e = await refusal(r, name, false);
    return NOT_CONFIGURED.has(e.code) ? { state: "none" } : { state: "error", message: e.message };
  }
  return { state: "error", message: (await refusal(r, name, false)).message };
}

/// Write a setting (`PUT` its document) or remove it (`DELETE`); throws a
/// `SettingError` with a sentence on failure.
export async function writeSetting(bucket: string, name: SettingName, method: "PUT" | "DELETE", doc?: unknown) {
  let r: Response;
  try {
    r = await fetch(settingUrl(bucket, name), {
      method,
      headers: doc === undefined ? undefined : { "Content-Type": "application/json" },
      body: doc === undefined ? undefined : JSON.stringify(doc),
    });
  } catch {
    throw new SettingError(UNREACHABLE, 0, "");
  }
  if (!r.ok) throw await refusal(r, name, true);
}

/// Change a bucket's lifecycle rules. A PUT replaces every rule, so the
/// rules are read again first and `change` edits what the gateway has now,
/// not what the page last saw: a rule someone else added meanwhile, or a
/// field the console has no control for (a tag filter, a date), is kept.
/// No rules left removes the configuration.
export async function changeLifecycle(bucket: string, change: (rules: LifecycleRuleDoc[]) => LifecycleRuleDoc[]) {
  const now = await readSetting<LifecycleDoc>(bucket, "lifecycle");
  if (now.state === "error") throw new SettingError(now.message, 0, "");
  const next = change(now.state === "set" ? (now.doc.Rule ?? []) : []);
  if (next.length === 0) await writeSetting(bucket, "lifecycle", "DELETE");
  else await writeSetting(bucket, "lifecycle", "PUT", { Rule: next } satisfies LifecycleDoc);
}

// ---- objects --------------------------------------------------------------

/// Keys go into a wildcard route, so slashes must survive while everything
/// else is escaped: `encodeURIComponent` on the whole key would turn the
/// prefix separators into %2F and address a different object.
export function keyPath(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

export function objectUrl(bucket: string, key: string): string {
  return `/_admin/buckets/${encodeURIComponent(bucket)}/objects/${keyPath(key)}`;
}

/// The admin listing returns at most this many keys under a prefix, with no
/// continuation.
export const LIST_LIMIT = 1000;

export async function listObjects(bucket: string, prefix: string) {
  const qs = new URLSearchParams({ delimiter: "/" });
  if (prefix) qs.set("prefix", prefix);
  const r = await fetch(`/_admin/buckets/${encodeURIComponent(bucket)}/objects?${qs}`);
  if (!r.ok) throw new Error((await r.text()) || `${r.status} ${r.statusText}`);
  const d = (await r.json()) as { contents?: S3Object[]; common_prefixes?: string[] };
  return { objects: d.contents ?? [], prefixes: d.common_prefixes ?? [] };
}

/// Every key under a prefix, folders' contents included, a listing page at
/// a time (the admin listing has no continuation, so a page is the first
/// `LIST_LIMIT` keys).
export async function listUnder(bucket: string, prefix: string): Promise<S3Object[]> {
  const qs = new URLSearchParams({ prefix });
  const r = await fetch(`/_admin/buckets/${encodeURIComponent(bucket)}/objects?${qs}`);
  if (!r.ok) throw new Error((await r.text()) || `${r.status} ${r.statusText}`);
  return ((await r.json()) as { contents?: S3Object[] }).contents ?? [];
}

/// What a one-byte ranged GET tells us about an object. The console has no
/// HEAD route of its own, and a ranged read returns every header HEAD would
/// without streaming the object.
export interface ObjectHead {
  size?: number;
  contentType?: string;
  etag?: string;
  lastModified?: string;
  encryption?: string;
  kmsKeyId?: string;
  versionId?: string;
  error?: string;
}

export async function headObject(bucket: string, key: string): Promise<ObjectHead> {
  const r = await fetch(objectUrl(bucket, key), { headers: { Range: "bytes=0-0" } });
  void r.body?.cancel();
  // 416: a zero-byte object has no byte 0; the headers are still there.
  if (!r.ok && r.status !== 416) throw new Error(`${r.status} ${r.statusText}`);
  const h = r.headers;
  const total = h.get("content-range")?.split("/")[1];
  return {
    size: total && total !== "*" ? Number(total) : undefined,
    contentType: h.get("content-type") ?? undefined,
    etag: h.get("etag") ?? undefined,
    lastModified: h.get("last-modified") ?? undefined,
    encryption: h.get("x-amz-server-side-encryption") ?? undefined,
    kmsKeyId: h.get("x-amz-server-side-encryption-aws-kms-key-id") ?? undefined,
    versionId: h.get("x-amz-version-id") ?? undefined,
  };
}

async function failure(r: Response) {
  const text = await r.text();
  return new Error(text || `${r.status} ${r.statusText}`);
}

export async function putObject(bucket: string, key: string, body: Blob | string, type?: string) {
  const r = await fetch(objectUrl(bucket, key), {
    method: "PUT",
    headers: { "Content-Type": type || "application/octet-stream" },
    body,
  });
  if (!r.ok) throw await failure(r);
}

export async function deleteObject(bucket: string, key: string) {
  const r = await fetch(objectUrl(bucket, key), { method: "DELETE" });
  if (!r.ok) throw await failure(r);
}

export async function deleteBucket(bucket: string) {
  const r = await fetch(`/_admin/buckets/${encodeURIComponent(bucket)}`, { method: "DELETE" });
  if (r.ok) return;
  const text = await r.text();
  if (r.status === 409 || /not empty/i.test(text))
    throw new Error("This bucket isn't empty. Delete its objects, then delete the bucket.");
  throw new Error(text || `${r.status} ${r.statusText}`);
}

/// Start a browser download of one object; the gateway answers with
/// `content-disposition: attachment`.
export function download(bucket: string, key: string) {
  const a = document.createElement("a");
  a.href = objectUrl(bucket, key);
  a.download = key.split("/").pop() || key;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function copyText(text: string) {
  void navigator.clipboard?.writeText(text);
}

// ---- words ----------------------------------------------------------------

/// Sizes in binary units, as the cluster reports capacity.
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

export function formatCount(n: number | undefined): string {
  if (n === undefined || n === null) return "—";
  if (n < 10_000) return n.toLocaleString();
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e5 ? 1 : 0)} K`;
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)} M`;
  return `${(n / 1e9).toFixed(2)} B`;
}

/// Timestamps arrive as unix seconds; a millisecond value is taken as is so
/// a mismatched field shows a sane date instead of one in the year 50000.
export function toDate(epoch: number | undefined): Date | null {
  if (!epoch) return null;
  return new Date(epoch > 1e12 ? epoch : epoch * 1000);
}

export function formatDate(epoch: number | undefined): string {
  const d = toDate(epoch);
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatShort(epoch: number | undefined): string {
  const d = toDate(epoch);
  if (!d) return "—";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatAgo(epoch: number | undefined, now = Date.now()): string {
  const d = toDate(epoch);
  if (!d) return "—";
  const s = Math.max(0, (now - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function tenantName(t: string | undefined): string {
  return t ? t : "system";
}

export function poolName(p: string | undefined): string {
  return p ? p : "default";
}

export type Versioning = "on" | "suspended" | "off";

export function versioningOf(v: number | undefined): Versioning {
  return v === 1 ? "on" : v === 2 ? "suspended" : "off";
}

export const VERSIONING_WORDS: Record<Versioning, string> = {
  on: "On",
  suspended: "Suspended",
  off: "Off",
};

/// The scheme in its short form: "4+2", "LRC 6+2+2", "3 copies".
export function schemeShort(p: PoolInfo | undefined): string | undefined {
  if (!p) return undefined;
  if (p.ec_type === 2 || (p.replication_count && !p.ec_k)) return `${p.replication_count ?? 0} copies`;
  if (p.ec_type === 1) return `LRC ${p.ec_k}+${p.ec_local_parity ?? 0}+${p.ec_global_parity ?? 0}`;
  if (p.ec_k) return `${p.ec_k}+${p.ec_m ?? 0}`;
  return undefined;
}

/// How many drives can fail at once without losing an object. LRC is
/// guaranteed against its global parity count (local groups add repairs,
/// not a wider guarantee).
export function failuresTolerated(p: PoolInfo | undefined): number | undefined {
  if (!p) return undefined;
  if (p.ec_type === 2 || (p.replication_count && !p.ec_k)) return Math.max(0, (p.replication_count ?? 1) - 1);
  if (p.ec_type === 1) return p.ec_global_parity ?? 0;
  if (p.ec_k) return p.ec_m ?? 0;
  return undefined;
}

/// "Survives any 2 drive failures (4+2)".
export function protectionSentence(p: PoolInfo | undefined): string | undefined {
  const n = failuresTolerated(p);
  const s = schemeShort(p);
  if (n === undefined || !s) return undefined;
  if (n === 0) return `No redundancy (${s}): one drive failure loses data`;
  return `Survives any ${n} drive failure${n === 1 ? "" : "s"} (${s})`;
}

/// "4 data and 2 parity shards, each on a different host".
export function layoutSentence(p: PoolInfo | undefined): string | undefined {
  if (!p) return undefined;
  const domain = p.failure_domain || "host";
  const where = `each on a different ${domain === "node" ? "host" : domain}`;
  if (p.ec_type === 2 || (p.replication_count && !p.ec_k)) return `${p.replication_count} full copies, ${where}`;
  if (p.ec_type === 1)
    return `${p.ec_k} data, ${p.ec_local_parity ?? 0} local and ${p.ec_global_parity ?? 0} global parity shards, ${where}`;
  if (p.ec_k) return `${p.ec_k} data and ${p.ec_m ?? 0} parity shards, ${where}`;
  return undefined;
}

// ---- access ---------------------------------------------------------------

const asList = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function principals(p: unknown): string[] {
  if (p === undefined || p === null) return [];
  if (typeof p === "string") return [p];
  if (Array.isArray(p)) return p.flatMap(principals);
  if (typeof p === "object") return Object.values(p as Record<string, unknown>).flatMap(principals);
  return [];
}

const READ_ONLY = /^s3:(Get|List|Head)/i;

export type PublicLevel = "private" | "read" | "write";

/// Who a bucket policy lets in. An Allow with principal `*` makes the bucket
/// public: for reading when every action it grants is a Get or List, for
/// writing otherwise.
export function readPolicy(policy: PolicyDoc | null) {
  const stmts = policy?.Statement ?? [];
  let pub: PublicLevel = "private";
  const named = new Set<string>();
  for (const s of stmts) {
    if ((s.Effect ?? "Allow") !== "Allow") continue;
    const who = principals(s.Principal);
    if (who.includes("*")) {
      const acts = asList(s.Action);
      const writes = acts.length === 0 || acts.some((a) => !READ_ONLY.test(a));
      if (writes) pub = "write";
      else if (pub === "private") pub = "read";
    }
    who.filter((w) => w !== "*").forEach((w) => named.add(w));
  }
  return { public: pub, statements: stmts.length, principals: [...named] };
}

/// The public access a bucket actually has once the cluster's (or the
/// tenant's) Block Public Access is applied: `RestrictPublicBuckets` makes a
/// public policy grant nothing to anonymous callers.
export function effectivePublic(level: PublicLevel, block: PublicAccessBlock | null): { level: PublicLevel; blocked: boolean } {
  if (level !== "private" && block?.RestrictPublicBuckets) return { level: "private", blocked: true };
  return { level, blocked: false };
}

export const PUBLIC_WORDS: Record<PublicLevel, string> = {
  private: "Private",
  read: "Public read",
  write: "Public write",
};

// ---- settings: documents --------------------------------------------------

/// The documents the setting routes take and answer: S3's configurations,
/// as JSON with S3's element names. A repeated element is an array; one that
/// S3 allows once (`Filter > Tag`) is an object.

export interface VersioningDoc {
  Status?: "Enabled" | "Suspended";
}

export interface LockDoc {
  ObjectLockEnabled?: string;
  Rule?: { DefaultRetention?: { Mode: string; Days?: number; Years?: number } };
}

export interface EncryptionDoc {
  Rule?: {
    ApplyServerSideEncryptionByDefault?: { SSEAlgorithm?: string; KMSMasterKeyID?: string };
    BucketKeyEnabled?: boolean;
  }[];
}

export interface TagDoc {
  Key: string;
  Value?: string;
}

export interface FilterDoc {
  Prefix?: string;
  Tag?: TagDoc;
  ObjectSizeGreaterThan?: number;
  ObjectSizeLessThan?: number;
  And?: { Prefix?: string; Tag?: TagDoc[] | TagDoc; ObjectSizeGreaterThan?: number; ObjectSizeLessThan?: number };
}

export interface LifecycleRuleDoc {
  ID?: string;
  Status: string;
  Filter?: FilterDoc;
  /// The old top-level prefix, in a rule with no `Filter`.
  Prefix?: string;
  Expiration?: { Days?: number; Date?: string; ExpiredObjectDeleteMarker?: boolean };
  NoncurrentVersionExpiration?: { NoncurrentDays?: number; NewerNoncurrentVersions?: number };
  AbortIncompleteMultipartUpload?: { DaysAfterInitiation?: number };
}

export interface LifecycleDoc {
  Rule?: LifecycleRuleDoc[];
}

export interface ReplicationRuleDoc {
  ID?: string;
  Priority?: number;
  Status: string;
  Prefix?: string;
  Filter?: FilterDoc;
  DeleteMarkerReplication?: { Status?: string };
  Destination?: { Bucket?: string };
}

export interface ReplicationDoc {
  Role?: string;
  Rule?: ReplicationRuleDoc[];
}

// ---- settings in words ----------------------------------------------------

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/// Object lock, from either the setting's document or the bucket listing.
/// `mode` is empty when there is no default retention.
export interface LockConfig {
  enabled: boolean;
  mode: "" | "GOVERNANCE" | "COMPLIANCE";
  days: number;
  years: number;
}

const asMode = (m: string | undefined): LockConfig["mode"] =>
  m === "GOVERNANCE" || m === "COMPLIANCE" ? m : m ? "COMPLIANCE" : "";

export function lockFromDoc(doc: LockDoc | undefined): LockConfig {
  const r = doc?.Rule?.DefaultRetention;
  return { enabled: doc?.ObjectLockEnabled === "Enabled", mode: asMode(r?.Mode), days: r?.Days ?? 0, years: r?.Years ?? 0 };
}

export function lockFromListing(l: BucketLock | undefined): LockConfig {
  const r = l?.default_retention;
  return { enabled: !!l?.enabled, mode: asMode(r?.mode), days: r?.days ?? 0, years: r?.years ?? 0 };
}

/// What a PUT takes: lock is always on (it can't be turned off), with one
/// of Days or Years when there is a default retention.
export function lockDoc(c: LockConfig): LockDoc {
  if (!c.mode || (c.days <= 0 && c.years <= 0)) return { ObjectLockEnabled: "Enabled" };
  return {
    ObjectLockEnabled: "Enabled",
    Rule: { DefaultRetention: { Mode: c.mode, ...(c.years > 0 ? { Years: c.years } : { Days: c.days }) } },
  };
}

function lockSpan(c: LockConfig) {
  return c.years ? plural(c.years, "year") : c.days ? plural(c.days, "day") : "";
}

/// "Governance, 7 days".
export function lockWords(c: LockConfig): string {
  if (!c.enabled) return "Off";
  const span = lockSpan(c);
  if (!c.mode || !span) return "On, no default retention";
  return `${c.mode === "GOVERNANCE" ? "Governance" : "Compliance"}, ${span}`;
}

/// What the lock does to a new object, in a sentence.
export function lockSentence(c: LockConfig): string {
  if (!c.enabled) return "Objects can be deleted and overwritten as usual.";
  const span = lockSpan(c);
  if (!c.mode || !span) return "Lock is on, but new objects are kept only when the upload asks for a retention.";
  if (c.mode === "GOVERNANCE")
    return `Every new object version is kept for ${span}. A user allowed to bypass governance retention can still delete it.`;
  return `Every new object version is kept for ${span}. No one can delete it or shorten that, an admin included.`;
}

/// "SSE-S3 (AES-256)".
export function encryptionWords(doc: EncryptionDoc | undefined): string {
  const by = doc?.Rule?.[0]?.ApplyServerSideEncryptionByDefault;
  const alg = by?.SSEAlgorithm ?? "";
  if (!alg) return "Off";
  if (alg === "AES256") return "SSE-S3 (AES-256)";
  if (alg === "aws:kms" || alg === "aws:kms:dsse") return by?.KMSMasterKeyID ? `SSE-KMS · key ${by.KMSMasterKeyID}` : "SSE-KMS";
  return alg;
}

/// What happens to a new object, in a sentence.
export function encryptionSentence(doc: EncryptionDoc | undefined): string {
  const by = doc?.Rule?.[0]?.ApplyServerSideEncryptionByDefault;
  const alg = by?.SSEAlgorithm ?? "";
  if (!alg) return "New objects are stored unencrypted unless the upload asks for encryption.";
  if (alg === "AES256") return "Every new object is encrypted with AES-256, under a key the cluster keeps (SSE-S3).";
  if (alg.startsWith("aws:kms"))
    return by?.KMSMasterKeyID
      ? `Every new object is encrypted under the KMS key ${by.KMSMasterKeyID} (SSE-KMS).`
      : "Every new object is encrypted under the cluster's default KMS key (SSE-KMS).";
  return `New objects are encrypted with ${alg}.`;
}

const tagList = (t: TagDoc[] | TagDoc | undefined): TagDoc[] => (t === undefined ? [] : Array.isArray(t) ? t : [t]);

/// Which keys a rule's filter picks, in words: "logs/ · tagged env=dev".
/// Empty for every key.
function filterParts(f: FilterDoc | undefined, legacyPrefix: string | undefined) {
  const prefix = f?.Prefix ?? f?.And?.Prefix ?? legacyPrefix ?? "";
  const tags = [...tagList(f?.Tag), ...tagList(f?.And?.Tag)];
  const gt = f?.ObjectSizeGreaterThan ?? f?.And?.ObjectSizeGreaterThan;
  const lt = f?.ObjectSizeLessThan ?? f?.And?.ObjectSizeLessThan;
  const extra: string[] = [];
  if (tags.length) extra.push(`tagged ${tags.map((t) => `${t.Key}=${t.Value ?? ""}`).join(", ")}`);
  if (gt) extra.push(`over ${formatBytes(gt)}`);
  if (lt) extra.push(`under ${formatBytes(lt)}`);
  return { prefix, extra };
}

/// A lifecycle rule as the page shows it.
export interface LifecycleRule {
  id: string;
  enabled: boolean;
  prefix: string;
  /// Filter conditions beyond the prefix (tags, sizes), in words.
  conditions: string[];
  /// What the rule does, in words.
  actions: string;
}

export function lifecycleRule(r: LifecycleRuleDoc): LifecycleRule {
  const { prefix, extra } = filterParts(r.Filter, r.Prefix);
  const parts: string[] = [];
  const e = r.Expiration;
  if (e?.Days) parts.push(`objects expire after ${plural(e.Days, "day")}`);
  if (e?.Date) {
    const d = new Date(e.Date);
    parts.push(
      `objects expire on ${Number.isNaN(d.getTime()) ? e.Date : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`,
    );
  }
  const n = r.NoncurrentVersionExpiration;
  if (n?.NoncurrentDays)
    parts.push(
      `earlier versions expire after ${plural(n.NoncurrentDays, "day")}${n.NewerNoncurrentVersions ? `, keeping the newest ${n.NewerNoncurrentVersions}` : ""}`,
    );
  if (e?.ExpiredObjectDeleteMarker) parts.push("delete markers with no versions left are removed");
  const a = r.AbortIncompleteMultipartUpload?.DaysAfterInitiation;
  if (a) parts.push(`unfinished uploads are aborted after ${plural(a, "day")}`);
  return {
    id: r.ID ?? "",
    enabled: r.Status === "Enabled",
    prefix,
    conditions: extra,
    actions: capital(parts.join("; ") || "no actions"),
  };
}

/// "2 rules, 1 on · objects under logs/ expire after 30 days".
export function lifecycleWords(rules: LifecycleRuleDoc[]): string {
  if (!rules.length) return "None";
  const all = rules.map(lifecycleRule);
  const on = all.filter((r) => r.enabled);
  const head = `${plural(all.length, "rule")}${on.length !== all.length ? `, ${on.length} on` : ""}`;
  const first = on[0];
  if (!first) return head;
  return `${head} · ${first.prefix ? `under ${first.prefix}, ` : ""}${first.actions.charAt(0).toLowerCase()}${first.actions.slice(1)}`;
}

/// What the "Add rule" form collects.
export interface LifecycleDraft {
  id: string;
  prefix: string;
  expiration_days: number;
  noncurrent_days: number;
  abort_days: number;
  delete_markers: boolean;
}

/// The form as a rule document. S3 takes an expiry in days or the removal
/// of expired delete markers, not both, so the form offers one at a time.
export function lifecycleRuleDoc(d: LifecycleDraft): LifecycleRuleDoc {
  return {
    ID: d.id.trim(),
    Status: "Enabled",
    Filter: d.prefix ? { Prefix: d.prefix } : {},
    ...(d.expiration_days > 0
      ? { Expiration: { Days: d.expiration_days } }
      : d.delete_markers
        ? { Expiration: { ExpiredObjectDeleteMarker: true } }
        : {}),
    ...(d.noncurrent_days > 0 ? { NoncurrentVersionExpiration: { NoncurrentDays: d.noncurrent_days } } : {}),
    ...(d.abort_days > 0 ? { AbortIncompleteMultipartUpload: { DaysAfterInitiation: d.abort_days } } : {}),
  };
}

/// A replication destination's target name: S3 writes it as an ARN.
export const targetName = (arn: string | undefined) => (arn ?? "").replace(/^arn:[^:]*:[^:]*:::/, "");

/// A replication rule as the page shows it.
export interface ReplicationRule {
  id: string;
  enabled: boolean;
  priority?: number;
  target: string;
  /// Which keys it copies, in words.
  scope: string;
  deletes: boolean;
}

export function replicationRule(r: ReplicationRuleDoc): ReplicationRule {
  const { prefix, extra } = filterParts(r.Filter, r.Prefix);
  const scope = [prefix ? `Keys under ${prefix}` : "All keys", ...extra].join(", ");
  return {
    id: r.ID ?? "",
    enabled: r.Status === "Enabled",
    priority: r.Priority,
    target: targetName(r.Destination?.Bucket),
    scope,
    deletes: r.DeleteMarkerReplication?.Status === "Enabled",
  };
}

/// "To site-b".
export function replicationWords(doc: ReplicationDoc | undefined): string {
  const rules = (doc?.Rule ?? []).map(replicationRule);
  if (!rules.length) return "Off";
  const on = rules.filter((r) => r.enabled);
  if (!on.length) return `${plural(rules.length, "rule")}, all off`;
  const targets = [...new Set(on.map((r) => r.target).filter(Boolean))];
  const tail = on.length !== rules.length ? ` · ${on.length} of ${rules.length} rules on` : "";
  return `${targets.length ? `To ${targets.join(", ")}` : plural(on.length, "rule")}${tail}`;
}
