import { useState } from "react";
import { Input, Select } from "../ui";
import { unity } from "../../api/client";
import { FormDialog } from "./Dialogs";
import { icebergExtra, warehouses, type Sel } from "./model";

export type NewKind = "namespace" | "warehouse" | "schema" | "catalog";

const TITLES: Record<NewKind, string> = {
  namespace: "New Iceberg namespace",
  warehouse: "New warehouse",
  schema: "New Unity schema",
  catalog: "New Unity catalog",
};

/// One dialog for everything the catalog can create: a warehouse or a
/// namespace in it, a Unity catalog or a schema in it. Tables are created by
/// engines (Iceberg) or in the Unity advanced view.
export default function NewDialog({
  kind: initial,
  warehouseNames,
  catalogNames,
  defaultWarehouse,
  defaultCatalog,
  onClose,
  onCreated,
}: {
  kind: NewKind;
  warehouseNames: string[];
  catalogNames: string[];
  defaultWarehouse?: string;
  defaultCatalog?: string;
  onClose: () => void;
  onCreated: (s: Sel) => void;
}) {
  const [kind, setKind] = useState<NewKind>(initial);
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [wh, setWh] = useState(defaultWarehouse ?? warehouseNames[0] ?? "");
  const [cat, setCat] = useState(defaultCatalog ?? catalogNames[0] ?? "");
  const n = name.trim();

  const needsParent = (kind === "namespace" && !wh) || (kind === "schema" && !cat);
  const submit = async () => {
    switch (kind) {
      case "warehouse":
        await warehouses.create(n);
        onCreated({ kind: "warehouse", wh: n });
        break;
      case "namespace":
        await icebergExtra.createNamespace(wh, n);
        onCreated({ kind: "namespace", wh, ns: n });
        break;
      case "catalog":
        await unity.createCatalog(n, comment.trim());
        onCreated({ kind: "catalog", cat: n });
        break;
      case "schema":
        await unity.createSchema(cat, n, comment.trim());
        onCreated({ kind: "schema", cat, schema: n });
        break;
    }
  };

  return (
    <FormDialog
      title={TITLES[kind]}
      submit={`Create ${kind}`}
      canSubmit={!!n && !needsParent}
      onSubmit={submit}
      onClose={onClose}
    >
      <Select label="Create" value={kind} onChange={(e) => setKind(e.target.value as NewKind)}>
        <optgroup label="Iceberg">
          <option value="namespace">Namespace</option>
          <option value="warehouse">Warehouse</option>
        </optgroup>
        <optgroup label="Unity Catalog">
          <option value="schema">Schema</option>
          <option value="catalog">Catalog</option>
        </optgroup>
      </Select>
      {kind === "namespace" &&
        (warehouseNames.length ? (
          <Select label="Warehouse" value={wh} onChange={(e) => setWh(e.target.value)}>
            {warehouseNames.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </Select>
        ) : (
          <p className="text-[12px] text-muted">There is no warehouse yet. Create a warehouse first.</p>
        ))}
      {kind === "schema" &&
        (catalogNames.length ? (
          <Select label="Catalog" value={cat} onChange={(e) => setCat(e.target.value)}>
            {catalogNames.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        ) : (
          <p className="text-[12px] text-muted">There is no Unity catalog yet. Create a catalog first.</p>
        ))}
      <Input
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={kind === "warehouse" ? "sales-lake" : kind === "catalog" ? "main" : "analytics"}
        className="font-mono"
        hint={
          kind === "warehouse"
            ? "Creates the bucket iceberg-<name> for its data."
            : kind === "catalog"
              ? "Creates the bucket unity-<name> for its managed tables."
              : undefined
        }
      />
      {(kind === "catalog" || kind === "schema") && (
        <Input label="Comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional" />
      )}
    </FormDialog>
  );
}
