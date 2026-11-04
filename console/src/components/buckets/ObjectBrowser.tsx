import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Copy, Download, File, Folder, FolderPlus, RefreshCw, Search, Trash2 } from "lucide-react";
import { Badge, Button, Cell, Input } from "../ui";
import { CardFrame, DangerTextButton, DetailsPanel, Kv, PanelSection, SelectableRow, Th } from "./parts";
import {
  copyText,
  deleteObject,
  download,
  formatBytes,
  formatShort,
  headObject,
  LIST_LIMIT,
  listObjects,
  listUnder,
  poolName,
  putObject,
  schemeShort,
  versioningOf,
  type BucketInfo,
  type ObjectHead,
  type PoolInfo,
  type S3Object,
} from "./model";

interface Listing {
  objects: S3Object[];
  prefixes: string[];
  ms: number;
  error?: string;
}

/// The Objects tab: one folder of a bucket at a time. Folders are the
/// listing's common prefixes under `/`; there are no directories, only keys.
export default function ObjectBrowser({
  bucket,
  pool,
  prefix,
  onPrefix,
  selectedKey,
  onSelect,
  reloadKey,
  onBusy,
  onError,
  onChanged,
}: {
  bucket: BucketInfo;
  pool: PoolInfo | undefined;
  prefix: string;
  onPrefix: (p: string) => void;
  selectedKey: string;
  onSelect: (key: string) => void;
  /// Bumped by the page after an upload, to list again.
  reloadKey: number;
  onBusy: (msg: string) => void;
  onError: (msg: string) => void;
  /// Called after this tab changed the bucket (a delete, a new folder).
  onChanged: () => void;
}) {
  const name = bucket.name;
  const [listing, setListing] = useState<(Listing & { at: string }) | null>(null);
  const [n, setN] = useState(0);
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [folderName, setFolderName] = useState<string | null>(null);

  const at = `${name}\u0000${prefix}\u0000${reloadKey}\u0000${n}`;
  useEffect(() => {
    let cancelled = false;
    const t0 = performance.now();
    listObjects(name, prefix)
      .then((r) => ({ ...r, ms: performance.now() - t0 }))
      .catch((e: Error) => ({ objects: [], prefixes: [], ms: 0, error: e.message }))
      .then((l) => {
        if (!cancelled) setListing({ ...l, at });
      });
    return () => {
      cancelled = true;
    };
  }, [name, prefix, at]);

  const current = listing && listing.at === at ? listing : null;
  // While a new folder loads, the old rows stay up rather than flashing.
  const shown = current ?? listing;
  const loading = !current;
  const refresh = () => setN((x) => x + 1);

  const q = search.trim().toLowerCase();
  const folders = (shown?.prefixes ?? [])
    .filter((p) => p !== prefix && p.startsWith(prefix))
    .filter((p) => !q || p.slice(prefix.length).toLowerCase().includes(q));
  const files = (shown?.objects ?? [])
    .filter((o) => o.key !== prefix && o.key.startsWith(prefix))
    .filter((o) => !q || o.key.slice(prefix.length).toLowerCase().includes(q));
  const bytes = files.reduce((a, o) => a + (o.size || 0), 0);
  const truncated = (shown?.objects.length ?? 0) >= LIST_LIMIT;

  const checkedFiles = files.filter((o) => checked.has(o.key));
  const checkedFolders = folders.filter((p) => checked.has(p));
  const checkedCount = checkedFiles.length + checkedFolders.length;
  const rowCount = files.length + folders.length;
  const allChecked = rowCount > 0 && checkedCount === rowCount;
  const toggle = (key: string) =>
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const parts = prefix.split("/").filter(Boolean);
  const goTo = (p: string) => {
    setSearch("");
    setChecked(new Set());
    onPrefix(p);
  };
  const up = () => goTo(parts.length > 1 ? `${parts.slice(0, -1).join("/")}/` : "");

  const selected = useMemo(() => {
    if (!selectedKey) return null;
    return (
      shown?.objects.find((o) => o.key === selectedKey) ?? { key: selectedKey, size: 0, last_modified: 0, etag: "" }
    );
  }, [selectedKey, shown]);

  const versioned = versioningOf(bucket.versioning) !== "off";
  const deleteNote = versioned
    ? "In this versioned bucket that adds a delete marker; earlier versions are kept."
    : "This can't be undone.";

  /// Delete objects, and folders with everything under them. A folder is
  /// its keys: each is listed and deleted, a listing page at a time, until
  /// none is left.
  const removeKeys = async (keys: string[], folderPrefixes: string[] = []) => {
    const words = [
      folderPrefixes.length ? `${folderPrefixes.length === 1 ? `folder ${folderPrefixes[0]}` : `${folderPrefixes.length} folders`} with everything in ${folderPrefixes.length === 1 ? "it" : "them"}` : "",
      keys.length ? (keys.length === 1 ? keys[0] : `${keys.length} objects`) : "",
    ].filter(Boolean);
    if (!confirm(`Delete ${words.join(", and ")}? ${deleteNote}`)) return;
    onError("");
    let done = 0;
    const del = async (k: string) => {
      onBusy(`Deleting ${k} (${++done} so far)`);
      await deleteObject(name, k);
    };
    try {
      for (const k of keys) await del(k);
      for (const f of folderPrefixes) {
        for (let guard = 0; guard < 1000; guard++) {
          const page = await listUnder(name, f);
          if (page.length === 0) break;
          for (const o of page) await del(o.key);
        }
        // An empty folder's marker, if the listing left it out.
        await deleteObject(name, f).catch(() => {});
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
    onBusy("");
    setChecked(new Set());
    if (keys.includes(selectedKey) || folderPrefixes.some((f) => selectedKey.startsWith(f))) onSelect("");
    refresh();
    onChanged();
  };

  const createFolder = async () => {
    const f = (folderName ?? "").trim().replace(/^\/+|\/+$/g, "");
    if (!f) return;
    onBusy(`Creating ${f}/`);
    onError("");
    try {
      // There are no directories in object storage: a folder is a zero-byte
      // key ending in the delimiter, which is what makes an otherwise empty
      // prefix show up in a delimited listing.
      await putObject(name, `${prefix}${f}/`, "");
      setFolderName(null);
      refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      onBusy("");
    }
  };

  const scheme = schemeShort(pool);
  const storage = `${poolName(bucket.pool)}${scheme ? ` · ${scheme}` : ""}`;

  return (
    <div className={`grid gap-4 items-start ${selected ? "xl:grid-cols-[minmax(0,1fr)_380px]" : ""}`}>
      <CardFrame label="Objects" className="overflow-hidden">
        <div className="flex gap-2 p-3 flex-wrap items-center border-b border-border">
          <nav
            aria-label="Folder"
            className="flex items-center gap-1 flex-[1_1_260px] min-w-0 font-mono text-[12.5px] overflow-x-auto whitespace-nowrap"
          >
            {parts.length === 0 ? (
              <span className="font-medium text-text">{name}</span>
            ) : (
              <button type="button" onClick={() => goTo("")} className="text-accent hover:underline">
                {name}
              </button>
            )}
            <span className="text-muted" aria-hidden="true">
              /
            </span>
            {parts.map((p, i) => {
              const last = i === parts.length - 1;
              return (
                <span key={i} className="inline-flex items-center gap-1">
                  {last ? (
                    <span className="font-medium text-text" aria-current="location">
                      {p}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => goTo(`${parts.slice(0, i + 1).join("/")}/`)}
                      className="text-accent hover:underline"
                    >
                      {p}
                    </button>
                  )}
                  <span className="text-muted" aria-hidden="true">
                    /
                  </span>
                </span>
              );
            })}
          </nav>
          <div className="flex-[0_1_240px] min-w-[180px]">
            <Input
              type="search"
              aria-label="Search in this folder"
              icon={<Search size={13} />}
              placeholder="Search in this folder"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="ghost" icon={<RefreshCw size={13} />} onClick={refresh} aria-label="Refresh the listing" title="Refresh the listing" />
          <Button icon={<FolderPlus size={13} />} onClick={() => setFolderName("")}>
            New folder
          </Button>
        </div>

        {folderName !== null && (
          <form
            className="flex gap-2 items-end px-3 py-2.5 border-b border-border bg-surface-2 flex-wrap"
            onSubmit={(e) => {
              e.preventDefault();
              void createFolder();
            }}
          >
            <div className="flex-[0_1_320px]">
              <Input
                label={`New folder in ${prefix || `${name}/`}`}
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder="folder-name"
                className="font-mono"
                autoFocus
              />
            </div>
            <Button type="submit" size="md" disabled={!folderName.trim()}>
              Create folder
            </Button>
            <Button type="button" variant="ghost" onClick={() => setFolderName(null)}>
              Cancel
            </Button>
          </form>
        )}

        {checkedCount > 0 && (
          <div className="flex gap-2 items-center px-3 py-2 bg-accent-soft border-b border-border flex-wrap">
            <span className="text-[12.5px] font-medium text-accent flex-1">
              {[
                checkedFolders.length ? `${checkedFolders.length} folder${checkedFolders.length === 1 ? "" : "s"}` : "",
                checkedFiles.length ? `${checkedFiles.length} object${checkedFiles.length === 1 ? "" : "s"}` : "",
              ]
                .filter(Boolean)
                .join(" and ")}{" "}
              selected
              {checkedFiles.length ? ` · ${formatBytes(checkedFiles.reduce((a, o) => a + o.size, 0))}` : ""}
            </span>
            <Button
              size="sm"
              icon={<Download size={13} />}
              disabled={checkedFiles.length === 0}
              title={checkedFiles.length === 0 ? "Folders download one object at a time: open the folder" : undefined}
              onClick={() => checkedFiles.forEach((o, i) => setTimeout(() => download(name, o.key), i * 300))}
            >
              Download
            </Button>
            <DangerTextButton
              icon={<Trash2 size={13} />}
              onClick={() => void removeKeys(checkedFiles.map((o) => o.key), checkedFolders)}
            >
              Delete…
            </DangerTextButton>
            <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())}>
              Clear
            </Button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[640px]">
            <thead>
              <tr>
                <Th className="w-[38px]">
                  <input
                    type="checkbox"
                    aria-label="Select everything in this folder"
                    checked={allChecked}
                    disabled={rowCount === 0}
                    onChange={() => setChecked(allChecked ? new Set() : new Set([...folders, ...files.map((o) => o.key)]))}
                    className="w-3.5 h-3.5 accent-accent align-middle"
                  />
                </Th>
                <Th>Name</Th>
                <Th align="right">Size</Th>
                <Th>Modified</Th>
                <Th>Storage</Th>
              </tr>
            </thead>
            <tbody>
              {loading && !shown && (
                <tr>
                  <td colSpan={5} className="px-3.5">
                    <div className="h-16 flex items-center">
                      <div className="h-0.5 w-full bg-surface-2 rounded overflow-hidden">
                        <div className="h-full w-1/3 bg-accent animate-[loading-bar_1.2s_ease-in-out_infinite]" />
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              {prefix && (
                <SelectableRow selected={false} onSelect={up}>
                  <Cell />
                  <Cell>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        up();
                      }}
                      className="inline-flex items-center gap-2 font-mono text-[12.5px] text-text hover:text-accent"
                      aria-label="Up one folder"
                    >
                      <ChevronLeft size={14} className="text-muted" />
                      ..
                    </button>
                  </Cell>
                  <Cell />
                  <Cell />
                  <Cell />
                </SelectableRow>
              )}
              {folders.map((p) => (
                <SelectableRow key={p} selected={checked.has(p)} onSelect={() => goTo(p)}>
                  <Cell>
                    <input
                      type="checkbox"
                      aria-label={`Select folder ${p.slice(prefix.length)}`}
                      checked={checked.has(p)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggle(p)}
                      className="w-3.5 h-3.5 accent-accent align-middle"
                    />
                  </Cell>
                  <Cell>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        goTo(p);
                      }}
                      className="inline-flex items-center gap-2 font-mono text-[12.5px] font-medium text-text hover:text-accent hover:underline text-left"
                    >
                      <Folder size={15} className="text-accent shrink-0" aria-hidden="true" />
                      <span className="break-all">{p.slice(prefix.length)}</span>
                    </button>
                  </Cell>
                  <Cell align="right" className="text-muted">
                    —
                  </Cell>
                  <Cell className="text-muted">—</Cell>
                  <Cell className="text-muted">—</Cell>
                </SelectableRow>
              ))}
              {files.map((o) => {
                const isSel = o.key === selectedKey;
                const isChecked = checked.has(o.key);
                const label = o.key.slice(prefix.length);
                return (
                  <SelectableRow key={o.key} selected={isSel || isChecked} onSelect={() => onSelect(isSel ? "" : o.key)}>
                    <Cell>
                      <input
                        type="checkbox"
                        aria-label={`Select ${label}`}
                        checked={isChecked}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggle(o.key)}
                        className="w-3.5 h-3.5 accent-accent align-middle"
                      />
                    </Cell>
                    <Cell>
                      <button
                        type="button"
                        aria-pressed={isSel}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(isSel ? "" : o.key);
                        }}
                        className={`inline-flex items-center gap-2 font-mono text-[12.5px] font-medium text-left hover:underline ${
                          isSel ? "text-accent" : "text-text hover:text-accent"
                        }`}
                      >
                        <File size={15} className={`shrink-0 ${isSel ? "text-accent" : "text-muted"}`} aria-hidden="true" />
                        <span className="break-all">{label}</span>
                      </button>
                    </Cell>
                    <Cell align="right" className="tabular-nums whitespace-nowrap">
                      {formatBytes(o.size)}
                    </Cell>
                    <Cell className="tabular-nums whitespace-nowrap">{formatShort(o.last_modified)}</Cell>
                    <Cell>
                      <span className="whitespace-nowrap">
                        <span className="font-mono">{poolName(bucket.pool)}</span>
                        {scheme && <span className="text-muted"> · {scheme}</span>}
                      </span>
                    </Cell>
                  </SelectableRow>
                );
              })}
              {!loading && !shown?.error && folders.length === 0 && files.length === 0 && (
                <tr className="border-t border-border">
                  <td colSpan={5} className="px-3.5 py-10 text-center text-[12.5px] text-muted">
                    {q ? "Nothing in this folder matches." : prefix ? "This folder is empty." : "This bucket is empty. Upload files to add objects."}
                  </td>
                </tr>
              )}
              {shown?.error && (
                <tr className="border-t border-border">
                  <td colSpan={5} className="px-3.5 py-8 text-center text-[12.5px] text-err">
                    Couldn't list this folder: {shown.error}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between gap-3 flex-wrap px-3.5 py-2.5 border-t border-border text-[12px] text-muted">
          <span>
            {folders.length} folder{folders.length === 1 ? "" : "s"}, {files.length} object{files.length === 1 ? "" : "s"} ·{" "}
            {formatBytes(bytes)} in this folder
            {truncated ? ` · only the first ${LIST_LIMIT.toLocaleString()} keys under it are listed` : ""}
          </span>
          {current && !current.error && <span className="tabular-nums">Listed in {Math.max(1, Math.round(current.ms))} ms</span>}
        </div>
      </CardFrame>

      {selected && (
        <ObjectPanel
          key={selected.key}
          bucket={bucket}
          obj={selected}
          storage={storage}
          onClose={() => onSelect("")}
          onDelete={() => void removeKeys([selected.key])}
        />
      )}
    </div>
  );
}

function formatLong(d: Date): string {
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

/// `"abc…-7"` is how S3 marks a multipart upload's ETag; the suffix is the
/// part count.
function multipartParts(etag: string | undefined): number | null {
  const m = etag?.replace(/"/g, "").match(/-(\d+)$/);
  return m ? Number(m[1]) : null;
}

function encryptionWords(d: ObjectHead): string {
  if (!d.encryption) return "None";
  if (d.encryption === "AES256") return "SSE-S3 (AES-256)";
  if (d.encryption === "aws:kms") return d.kmsKeyId ? `SSE-KMS · key ${d.kmsKeyId}` : "SSE-KMS";
  return d.encryption;
}

function ObjectPanel({
  bucket,
  obj,
  storage,
  onClose,
  onDelete,
}: {
  bucket: BucketInfo;
  obj: S3Object;
  storage: string;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [head, setHead] = useState<ObjectHead | null>(null);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    let cancelled = false;
    headObject(bucket.name, obj.key)
      .catch((e: Error) => ({ error: e.message }) as ObjectHead)
      .then((h) => {
        if (!cancelled) setHead(h);
      });
    return () => {
      cancelled = true;
    };
  }, [bucket.name, obj.key]);

  const name = obj.key.split("/").filter(Boolean).pop() ?? obj.key;
  const size = head?.size ?? obj.size;
  const etag = head?.etag ?? obj.etag;
  const parts = multipartParts(etag);
  const pending = <span className="text-muted">{head ? "—" : "…"}</span>;
  const versioning = versioningOf(bucket.versioning);

  const copy = (what: string, text: string) => {
    copyText(text);
    setCopied(what);
    setTimeout(() => setCopied(""), 1500);
  };

  return (
    <DetailsPanel label="Object details" overline="Object" title={name} onClose={onClose}>
      <div className="px-4 pb-3.5 flex gap-2 flex-wrap">
        <Button size="sm" icon={<Download size={13} />} onClick={() => download(bucket.name, obj.key)}>
          Download
        </Button>
        <Button size="sm" icon={<Copy size={13} />} onClick={() => copy("key", obj.key)}>
          {copied === "key" ? "Copied" : "Copy key"}
        </Button>
        <Button size="sm" icon={<Copy size={13} />} onClick={() => copy("uri", `s3://${bucket.name}/${obj.key}`)}>
          {copied === "uri" ? "Copied" : "Copy S3 URI"}
        </Button>
      </div>
      <PanelSection>
        {head?.error && (
          <p className="text-[12px] text-warn">Couldn't read the object's headers ({head.error}); showing the listing's data.</p>
        )}
        <Kv
          labelWidth={96}
          rows={[
            ["Key", <span className="font-mono text-[11.5px] break-all">{obj.key}</span>],
            [
              "Size",
              <span className="tabular-nums">
                {formatBytes(size)}
                {size >= 1024 ? <span className="text-muted"> · {size.toLocaleString()} bytes</span> : null}
              </span>,
            ],
            ["Type", head?.contentType || pending],
            [
              "Modified",
              <span className="tabular-nums">
                {head?.lastModified ? formatLong(new Date(head.lastModified)) : formatShort(obj.last_modified)}
              </span>,
            ],
            [
              "ETag",
              etag ? (
                <span className="font-mono text-[11.5px] break-all">
                  {etag.startsWith('"') ? etag : `"${etag}"`}
                  {parts ? <span className="font-sans text-muted"> · uploaded in {parts} parts</span> : null}
                </span>
              ) : (
                pending
              ),
            ],
            ["Encryption", head && !head.error ? encryptionWords(head) : pending],
            ["Storage", storage],
          ]}
        />
        {/* Where the object's shards sit (which OSDs, hosts and placement
            group) isn't served by any API the console can call: it needs an
            admin endpoint that resolves a key to its placement group and
            acting set. Until then the panel names the pool and its scheme. */}
      </PanelSection>
      <PanelSection title="Versions">
        {versioning === "off" ? (
          <p className="text-[12.5px] text-muted">Versioning is off for this bucket: an overwrite replaces this object.</p>
        ) : head?.versionId ? (
          <div className="flex items-center justify-between gap-2 text-[12.5px]">
            <span className="flex items-center gap-2 min-w-0">
              <Badge kind="info">Current</Badge>
              <span className="font-mono text-[11.5px] truncate" title={head.versionId}>
                {head.versionId}
              </span>
            </span>
          </div>
        ) : (
          <p className="text-[12.5px] text-muted">{head ? "This object has no version id: it was written while versioning was off." : "…"}</p>
        )}
        {versioning !== "off" && (
          <p className="text-[11.5px] text-muted">Earlier versions can't be listed from the console yet: that needs an admin route for version listing.</p>
        )}
      </PanelSection>
      <PanelSection>
        <div>
          <DangerTextButton icon={<Trash2 size={13} />} onClick={onDelete}>
            Delete object
          </DangerTextButton>
        </div>
      </PanelSection>
    </DetailsPanel>
  );
}
