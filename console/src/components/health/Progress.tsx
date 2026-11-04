/// A drain's progress: the 6px track of the capacity bar, filled in the
/// repairing colour whatever the fill (a nearly finished drain is not a
/// problem, so the capacity bar's 90% red would mislead).
export default function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 100;
  return (
    <div
      className="h-1.5 rounded-full bg-surface-2 border border-border overflow-hidden"
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full bg-warn-dot" style={{ width: `${pct}%` }} />
    </div>
  );
}
