import { useEffect, useState } from "react";
import { Button, Input, Select } from "../ui";
import { CardFrame } from "./parts";
import { schemeShort, type PoolInfo } from "./model";

const NAME_RULE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/// The create form, shown under the page header. The tenant and pool fields
/// appear only when this console can list them (a system admin's).
export default function CreateBucket({
  pools,
  onCancel,
  onCreated,
}: {
  pools: PoolInfo[] | null;
  onCancel: () => void;
  onCreated: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [tenant, setTenant] = useState("");
  const [pool, setPool] = useState("");
  const [tenants, setTenants] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/_admin/tenants")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { name: string }[] | { tenants: { name: string }[] }) =>
        setTenants((Array.isArray(d) ? d : (d.tenants ?? [])).map((t) => t.name)),
      )
      .catch(() => setTenants([]));
  }, []);

  const trimmed = name.trim();
  const invalid = trimmed && !NAME_RULE.test(trimmed) ? "Use 3 to 63 lowercase letters, digits, dots and dashes, starting and ending with a letter or digit." : "";

  const create = async () => {
    if (!trimmed || invalid) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/_admin/buckets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, ...(tenant ? { tenant } : {}), ...(pool ? { pool } : {}) }),
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(r.status === 409 ? `A bucket named ${trimmed} already exists. Pick another name.` : text || `${r.status} ${r.statusText}`);
      }
      onCreated(trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CardFrame label="Create bucket" className="p-4 flex flex-col gap-3">
      <h2 className="text-[14px] font-semibold text-text">Create bucket</h2>
      <form
        className="flex gap-3 items-start flex-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div className="flex-[1_1_260px]">
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="bucket-name"
            autoFocus
            className="font-mono"
            error={invalid || error || undefined}
            hint="The name is part of every object's address and can't be changed later."
          />
        </div>
        {tenants.length > 0 && (
          <div className="w-48">
            <Select label="Tenant" value={tenant} onChange={(e) => setTenant(e.target.value)}>
              <option value="">system</option>
              {tenants.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
        )}
        {pools && pools.length > 0 && (
          <div className="w-56">
            <Select label="Pool" value={pool} onChange={(e) => setPool(e.target.value)}>
              <option value="">The tenant's default</option>
              {pools.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                  {schemeShort(p) ? ` (${schemeShort(p)})` : ""}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="flex gap-2 pt-[19px]">
          <Button type="submit" variant="accent" disabled={!trimmed || !!invalid || busy}>
            {busy ? "Creating…" : "Create bucket"}
          </Button>
          <Button type="button" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </CardFrame>
  );
}
