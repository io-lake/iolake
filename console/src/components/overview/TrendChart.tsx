import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { seriesColor } from "../ui";

export interface TrendSeries {
  key: string;
  label: string;
  /// Fixed colour slot for this entity (`seriesColor`), not its position.
  color: number;
}

export type TrendRow = { t: number } & Record<string, number | undefined>;

const AXIS = { fontSize: 10, fontFamily: "var(--oio-font-mono)", fill: "var(--oio-faint)" };

/// Tick labels sized to the window: dates past two days, seconds under ten
/// minutes (the live window is five).
function clock(t: number, spanMs: number): string {
  const d = new Date(t);
  if (spanMs > 2 * 86_400_000) return d.toLocaleDateString([], { month: "short", day: "numeric" });
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: spanMs < 600_000 ? "2-digit" : undefined,
    hour12: false,
  });
}

/// Round y-axis ticks from zero: steps of 1, 2, 2.5 or 5 times a power of
/// ten, in the unit the top value is shown in (`base` 1024 for bytes, so a
/// tick reads 4 MiB rather than 3.8 MiB).
function niceTicks(max: number, base: number): number[] {
  if (!(max > 0)) return [0];
  const exp = base > 1 ? Math.floor(Math.log(max) / Math.log(base)) : 0;
  const unit = base > 1 ? base ** Math.max(0, exp) : 1;
  const v = max / unit;
  const raw = v / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const top = Math.ceil(v / step) * step;
  const out: number[] = [];
  for (let x = 0; x <= top + step / 2; x += step) out.push(x * unit);
  return out;
}

/// A line chart per the brand rules: 2px lines with an end dot, grid in
/// `border`, axis text in `faint` mono 10px, one y-axis, no area fill.
export default function TrendChart({
  rows,
  series,
  axisFormat,
  valueFormat,
  label,
  height = 200,
  base = 1,
}: {
  rows: TrendRow[];
  series: TrendSeries[];
  axisFormat: (v: number) => string;
  valueFormat: (v: number) => string;
  /// What the chart shows, for a screen reader.
  label: string;
  height?: number;
  /// 1024 for byte values, so ticks fall on round binary units.
  base?: number;
}) {
  const span = rows.length > 1 ? rows[rows.length - 1].t - rows[0].t : 0;
  const last = rows[rows.length - 1];
  let max = 0;
  for (const r of rows) for (const s of series) max = Math.max(max, Number(r[s.key] ?? 0));
  const ticks = niceTicks(max, base);
  return (
    <div role="img" aria-label={label} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 6, right: 24, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--oio-border)" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            minTickGap={48}
            tickFormatter={(v) => clock(Number(v), span)}
          />
          <YAxis
            ticks={ticks}
            domain={[0, ticks[ticks.length - 1] || 1]}
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(v) => axisFormat(Number(v))}
          />
          <Tooltip
            contentStyle={{
              background: "var(--oio-surface)",
              border: "1px solid var(--oio-border-strong)",
              borderRadius: 8,
              fontSize: 11,
              color: "var(--oio-text)",
            }}
            labelStyle={{ color: "var(--oio-muted)", fontFamily: "var(--oio-font-mono)" }}
            labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
            formatter={(v, name) => [valueFormat(Number(v)), name]}
          />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={seriesColor(s.color)}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3.5, strokeWidth: 0 }}
              isAnimationActive={false}
              connectNulls
            />
          ))}
          {last &&
            series.map((s) =>
              last[s.key] != null ? (
                <ReferenceDot
                  key={`end-${s.key}`}
                  x={last.t}
                  y={last[s.key]}
                  r={3.5}
                  fill={seriesColor(s.color)}
                  stroke="none"
                  ifOverflow="visible"
                />
              ) : null,
            )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/// A 96×28 sparkline: one series, no axes.
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const data = values.map((v, i) => ({ i, v }));
  return (
    <div className="w-24 h-7" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line
            type="monotone"
            dataKey="v"
            stroke={seriesColor(0)}
            strokeWidth={1.75}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
