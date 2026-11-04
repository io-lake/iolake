/// Number formatting for the overview, in the units the system reports:
/// capacity in binary units (GiB, TiB, PiB), latency in ms.

const IEC = ["B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB"];

/// `1.84 PiB`, `612 GiB`, `8.45 MiB`: three significant figures.
export function bytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const i = Math.min(IEC.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  const digits = i === 0 ? 0 : v < 10 ? 2 : v < 100 ? 1 : 0;
  return `${v.toFixed(digits)} ${IEC[i]}`;
}

/// Axis ticks: fewer figures, same units.
export function bytesShort(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const i = Math.min(IEC.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v < 10 && i > 0 ? Number(v.toFixed(1)) : Math.round(v)} ${IEC[i]}`;
}

/// A count with grouping: `41,200`.
export function count(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/// Requests per second: one decimal while small, whole numbers after.
export function perSecond(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  return n < 10 ? n.toFixed(1) : count(n);
}

/// Seconds to milliseconds, as a reader wants to see them.
export function ms(seconds: number): string {
  const v = seconds * 1000;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${count(n)} ${n === 1 ? one : many}`;
}

export function percent(used: number, total: number): number {
  return total > 0 ? (used / total) * 100 : 0;
}
