/// Formatting shared by the health page's cards. Capacity in IEC units, as the
/// system reports them; times relative to a `now` the caller passes, so a
/// render stays pure.

export function bytes(n: number): string {
  if (!n || n < 1024) return `${n || 0} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function count(n: number): string {
  return n.toLocaleString();
}

/// "4 min ago" from unix seconds; "never" for 0.
export function ago(unixSecs: number, nowMs: number): string {
  if (!unixSecs) return "never";
  const s = Math.max(0, Math.floor(nowMs / 1000 - unixSecs));
  if (s < 90) return `${s} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/// "for 12 min" from unix seconds.
export function duration(sinceSecs: number, nowMs: number): string {
  if (!sinceSecs) return "";
  const s = Math.max(0, Math.floor(nowMs / 1000 - sinceSecs));
  if (s < 90) return `${s} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

export function pct(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100) : 0;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${count(n)} ${n === 1 ? one : many}`;
}
