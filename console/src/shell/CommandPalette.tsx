import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CornerDownLeft } from "lucide-react";
import type { NavSection } from "./nav";

interface Props {
  onClose: () => void;
  sections: NavSection[];
}

/// Jump to any page by name (⌘K or Ctrl+K). Matches labels, section names
/// and each item's keywords. Mounted only while open, so it starts empty.
export default function CommandPalette({ onClose, sections }: Props) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);

  const items = useMemo(() => {
    const all = sections.flatMap((s) => s.items.map((i) => ({ ...i, section: s.title ?? "" })));
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return all;
    return all.filter((i) => {
      const hay = `${i.label} ${i.section} ${i.keywords ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [q, sections]);

  const go = (to: string) => {
    onClose();
    nav(to);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(14,31,38,.35)] pt-[12vh] px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Jump to a page"
        className="w-full max-w-[560px] bg-surface border border-border rounded-dialog shadow-pop overflow-hidden"
      >
        <div className="flex items-center gap-2.5 px-4 h-12 border-b border-border">
          <Search size={16} className="text-muted shrink-0" aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter" && items[sel]) go(items[sel].to);
            }}
            placeholder="Jump to a page"
            aria-label="Jump to a page"
            className="flex-1 bg-transparent outline-none text-[14px] text-text placeholder:text-muted"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-surface-2 text-muted">Esc</kbd>
        </div>
        <ul className="max-h-[360px] overflow-y-auto py-1.5" role="listbox" aria-label="Pages">
          {items.length === 0 && <li className="px-4 py-6 text-center text-[12px] text-muted">No page matches “{q}”.</li>}
          {items.map((i, idx) => (
            <li key={i.to} role="option" aria-selected={idx === sel}>
              <button
                type="button"
                onMouseEnter={() => setSel(idx)}
                onClick={() => go(i.to)}
                className={`w-full flex items-center gap-3 px-4 h-10 text-left text-[13px] ${
                  idx === sel ? "bg-accent-soft text-accent" : "text-text"
                }`}
              >
                <i.icon size={15} className="shrink-0" aria-hidden />
                <span className="flex-1 min-w-0 truncate font-medium">{i.label}</span>
                {i.section && <span className="text-[11px] text-muted">{i.section}</span>}
                {idx === sel && <CornerDownLeft size={13} className="text-muted" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
