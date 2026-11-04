import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, Copy, X } from "lucide-react";
import { Banner, Button, Tabs } from "../ui";

/// A centred dialog: Escape and the backdrop close it, focus moves into it.
export function Modal({
  title,
  sub,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  sub?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const first = box.current?.querySelector<HTMLElement>("input, textarea, select, button[data-autofocus]");
    first?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={`bg-surface border border-border rounded-dialog shadow-pop w-full ${wide ? "max-w-2xl" : "max-w-md"}
          max-h-[85vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-border">
          <div className="min-w-0">
            <h2 id={id} className="text-[14px] font-semibold text-text">
              {title}
            </h2>
            {sub && <div className="text-[12px] text-muted mt-0.5">{sub}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-control text-muted hover:text-text hover:bg-surface-2"
          >
            <X size={14} />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto min-h-0 flex-1">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-border bg-surface-2 rounded-b-dialog">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/// A form in a dialog: `fields` render inside, `onSubmit` runs on Enter or
/// the button, and its error stays in the dialog so the input is not lost.
export function FormDialog({
  title,
  sub,
  submit,
  canSubmit,
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  sub?: ReactNode;
  submit: string;
  canSubmit: boolean;
  onSubmit: () => Promise<void>;
  onClose: () => void;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      sub={sub}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!canSubmit || busy} onClick={() => void run()}>
            {busy ? "Working…" : submit}
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        {children}
        {error && <Banner kind="err" title={error} />}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/// Edit an entity's policy as JSON. Empty saves a policy with no
/// statements, which the gateways treat as no policy.
export function PolicyDialog({
  scope,
  note,
  example,
  load,
  save,
  onClose,
  onSaved,
}: {
  scope: string;
  note: ReactNode;
  example: string;
  load: () => Promise<unknown>;
  save: (policy: unknown) => Promise<unknown>;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  const fieldId = useId();

  useEffect(() => {
    let alive = true;
    loadRef
      .current()
      .then((p) => {
        if (!alive) return;
        const empty =
          p === null || p === undefined || (typeof p === "object" && Object.keys(p as object).length === 0);
        setText(empty ? "" : JSON.stringify(p, null, 2));
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const onSave = async () => {
    let parsed: unknown;
    try {
      parsed = text.trim() === "" ? { Version: "2012-10-17", Statement: [] } : JSON.parse(text);
    } catch (e) {
      setError(`This isn't valid JSON: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await save(parsed);
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Access policy"
      sub={<span className="font-mono">{scope}</span>}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || loading} onClick={() => void onSave()}>
            {busy ? "Saving…" : "Save policy"}
          </Button>
        </>
      }
    >
      <p className="text-[12px] text-text-2 mb-3">{note}</p>
      <label htmlFor={fieldId} className="block text-[11px] font-semibold text-text-2 mb-1">
        Policy JSON
      </label>
      {loading ? (
        <p className="py-8 text-center text-[12px] text-muted">Loading the current policy…</p>
      ) : (
        <textarea
          id={fieldId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={example}
          spellCheck={false}
          className="w-full min-h-[280px] p-3 font-mono text-[12px] bg-surface text-text border border-border-strong
            rounded-control placeholder:text-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
      )}
      {error && <Banner kind="err" title={error} className="mt-3" />}
    </Modal>
  );
}

export interface Snippet {
  key: string;
  label: string;
  text: string;
}

/// Connection details as copyable snippets, one tab per client.
export function ConnectionDialog({
  title,
  sub,
  snippets,
  note,
  onClose,
}: {
  title: string;
  sub?: ReactNode;
  snippets: Snippet[];
  note?: ReactNode;
  onClose: () => void;
}) {
  const [tab, setTab] = useState(snippets[0]?.key ?? "");
  const [copied, setCopied] = useState(false);
  const cur = snippets.find((s) => s.key === tab) ?? snippets[0];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cur.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the text stays selectable below */
    }
  };
  return (
    <Modal title={title} sub={sub} onClose={onClose} wide>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <Tabs items={snippets.map((s) => ({ key: s.key, label: s.label }))} value={tab} onChange={setTab} />
        <Button size="sm" data-autofocus icon={copied ? <Check size={13} /> : <Copy size={13} />} onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="bg-code-bg text-code-fg rounded-control p-3 text-[11.5px] font-mono overflow-x-auto whitespace-pre">
        {cur?.text}
      </pre>
      {note && <p className="text-[11.5px] text-muted mt-3">{note}</p>}
    </Modal>
  );
}
