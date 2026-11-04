/// What the Buckets pages read from the gateway, and how they put it into
/// words. Everything here comes from the admin API (`/_admin/*`, which takes
/// the console's session), except the bucket settings S3 keeps under
/// sub-resources (`?object-lock`, `?lifecycle`, `?encryption`,
/// `?replication`): those have no admin route, so they are read over the S3
/// path and come back refused when the console signs in with a session.

// ---- shapes ---------------------------------------------------------------

export interface BucketInfo {
  name: string;
  created_at?: number;
  owner?: string;
  /// 0 = never turned on, 1 = enabled, 2 = suspended.
  versioning?: number;
  /// Empty = the default pool.
  pool?: string;
  /// Empty = the system tenant.
  tenant?: string;
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

/// A bucket setting read over the S3 path.
/// - `set`: the bucket has one; `doc` is the parsed XML.
/// - `none`: the bucket has none (S3 answers 404 with a "not found" code).
/// - `refused`: the gateway would not answer the console's session.
/// - `error`: anything else.
export type S3Setting =
  | { state: "set"; doc: Document }
  | { state: "none" }
  | { state: "refused" }
  | { state: "error"; message: string };

/// Once the gateway has turned the console's session away on the S3 path,
/// it will again: the session is not an S3 credential. Remembered for the
/// page's life so every later read skips the round trip (and the 403 in the
/// browser's log).
let s3Refused = false;

export function s3SessionRefused() {
  return s3Refused;
}

export async function readS3Setting(bucket: string, sub: string): Promise<S3Setting> {
  if (s3Refused) return { state: "refused" };
  try {
    const r = await fetch(`/${encodeURIComponent(bucket)}?${sub}`);
    const text = await r.text();
    if (r.ok) return { state: "set", doc: new DOMParser().parseFromString(text, "text/xml") };
    if (r.status === 403 || r.status === 401) {
      const msg = new DOMParser().parseFromString(text, "text/xml").querySelector("Message")?.textContent ?? "";
      if (/anonymous/i.test(msg)) s3Refused = true;
      return { state: "refused" };
    }
    if (r.status === 404) {
      const code = new DOMParser().parseFromString(text, "text/xml").querySelector("Code")?.textContent ?? "";
      if (code === "NoSuchBucket") return { state: "error", message: "The bucket no longer exists." };
      return { state: "none" };
    }
    return { state: "error", message: `${r.status} ${r.statusText}` };
  } catch (e) {
    return { state: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/// Write a bucket setting over the S3 path; throws a sentence on failure.
export async function writeS3Setting(bucket: string, sub: string, method: "PUT" | "DELETE", xml?: string) {
  if (s3Refused) throw new Error(REFUSED);
  const r = await fetch(`/${encodeURIComponent(bucket)}?${sub}`, {
    method,
    headers: xml ? { "Content-Type": "application/xml" } : undefined,
    body: xml,
  });
  if (r.ok) return;
  const text = await r.text();
  if ((r.status === 403 || r.status === 401) && /anonymous/i.test(text)) {
    s3Refused = true;
    throw new Error(REFUSED);
  }
  const msg = new DOMParser().parseFromString(text, "text/xml").querySelector("Message")?.textContent;
  throw new Error(msg || text || `${r.status} ${r.statusText}`);
}

export const REFUSED =
  "The gateway refuses the console's session on the S3 API, and has no admin route for this setting yet. Change it with an S3 client.";

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

// ---- settings in words ----------------------------------------------------

const text = (d: Document | Element, sel: string) => d.querySelector(sel)?.textContent?.trim() ?? "";

export interface LockConfig {
  enabled: boolean;
  mode: string;
  days: number;
  years: number;
}

export function parseLock(doc: Document): LockConfig {
  return {
    enabled: text(doc, "ObjectLockEnabled") === "Enabled",
    mode: text(doc, "DefaultRetention > Mode") || "COMPLIANCE",
    days: parseInt(text(doc, "DefaultRetention > Days") || "0", 10),
    years: parseInt(text(doc, "DefaultRetention > Years") || "0", 10),
  };
}

export function lockWords(c: LockConfig): string {
  if (!c.enabled) return "Off";
  const mode = c.mode === "GOVERNANCE" ? "Governance" : "Compliance";
  const span = c.years
    ? `${c.years} year${c.years === 1 ? "" : "s"}`
    : c.days
      ? `${c.days} day${c.days === 1 ? "" : "s"}`
      : "";
  return span ? `${mode}, ${span}` : "On, no default retention";
}

export function encryptionWords(doc: Document): string {
  const alg = text(doc, "SSEAlgorithm");
  const key = text(doc, "KMSMasterKeyID");
  if (alg === "AES256") return "SSE-S3 (AES-256)";
  if (alg === "aws:kms") return key ? `SSE-KMS · key ${key}` : "SSE-KMS";
  return alg || "Off";
}

export interface LifecycleRule {
  id: string;
  status: string;
  prefix: string;
  expiration_days: number;
  noncurrent_days: number;
  abort_days: number;
  delete_markers: boolean;
}

export function parseLifecycle(doc: Document): LifecycleRule[] {
  return Array.from(doc.querySelectorAll("Rule")).map((node) => ({
    id: text(node, "ID"),
    status: text(node, "Status") || "Disabled",
    prefix: text(node, "Filter > Prefix") || text(node, "Prefix"),
    expiration_days: parseInt(text(node, "Expiration > Days") || "0", 10),
    noncurrent_days: parseInt(text(node, "NoncurrentVersionExpiration > NoncurrentDays") || "0", 10),
    abort_days: parseInt(text(node, "AbortIncompleteMultipartUpload > DaysAfterInitiation") || "0", 10),
    delete_markers: text(node, "Expiration > ExpiredObjectDeleteMarker") === "true",
  }));
}

/// "Objects under logs/ expire after 30 days".
export function ruleWords(r: LifecycleRule): string {
  const where = r.prefix ? `under ${r.prefix}` : "";
  const parts: string[] = [];
  if (r.expiration_days) parts.push(`objects ${where} expire after ${r.expiration_days} days`.replace("  ", " "));
  if (r.noncurrent_days) parts.push(`noncurrent versions expire after ${r.noncurrent_days} days`);
  if (r.abort_days) parts.push(`unfinished uploads are aborted after ${r.abort_days} days`);
  if (r.delete_markers) parts.push("expired delete markers are removed");
  const s = parts.join("; ") || "no actions";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function lifecycleWords(rules: LifecycleRule[]): string {
  if (!rules.length) return "None";
  const on = rules.filter((r) => r.status === "Enabled");
  const head = `${rules.length} rule${rules.length === 1 ? "" : "s"}${on.length !== rules.length ? `, ${on.length} on` : ""}`;
  return on[0] ? `${head} · ${ruleWords(on[0]).toLowerCase()}` : head;
}

export function lifecycleXml(rules: LifecycleRule[]): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = rules
    .map(
      (r) =>
        `<Rule><ID>${esc(r.id)}</ID><Status>${r.status}</Status><Filter><Prefix>${esc(r.prefix)}</Prefix></Filter>` +
        (r.expiration_days > 0
          ? `<Expiration><Days>${r.expiration_days}</Days>${r.delete_markers ? "<ExpiredObjectDeleteMarker>true</ExpiredObjectDeleteMarker>" : ""}</Expiration>`
          : "") +
        (r.noncurrent_days > 0
          ? `<NoncurrentVersionExpiration><NoncurrentDays>${r.noncurrent_days}</NoncurrentDays></NoncurrentVersionExpiration>`
          : "") +
        (r.abort_days > 0
          ? `<AbortIncompleteMultipartUpload><DaysAfterInitiation>${r.abort_days}</DaysAfterInitiation></AbortIncompleteMultipartUpload>`
          : "") +
        `</Rule>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><LifecycleConfiguration>${body}</LifecycleConfiguration>`;
}

export function lockXml(c: LockConfig): string {
  const retention =
    c.days > 0 || c.years > 0
      ? `<Rule><DefaultRetention><Mode>${c.mode}</Mode>${c.days > 0 ? `<Days>${c.days}</Days>` : ""}${c.years > 0 ? `<Years>${c.years}</Years>` : ""}</DefaultRetention></Rule>`
      : "";
  return `<?xml version="1.0" encoding="UTF-8"?><ObjectLockConfiguration><ObjectLockEnabled>${c.enabled ? "Enabled" : "Disabled"}</ObjectLockEnabled>${retention}</ObjectLockConfiguration>`;
}

export function replicationWords(doc: Document): string {
  const rules = Array.from(doc.querySelectorAll("Rule"));
  if (!rules.length) return "Off";
  const dests = [...new Set(rules.map((r) => text(r, "Destination > Bucket").replace(/^arn:[^:]*:s3:::/, "")).filter(Boolean))];
  return dests.length ? `To ${dests.join(", ")}` : `${rules.length} rule${rules.length === 1 ? "" : "s"}`;
}
