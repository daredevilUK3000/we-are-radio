import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * The pieces of the Studio Analytics screen: a time chart (stacked columns or a
 * line), horizontal bars, stat tiles and a sortable table. Plain SVG/HTML, no
 * chart library. Colours are CSS variables set on .an-page (see global.css),
 * validated as a set against the Studio's dark card surface.
 *
 * Every chart has a hover/focus readout, and every number in a chart is also in
 * a table somewhere, so nothing depends on hovering or on telling colours apart.
 */

// ---------------------------------------------------------------- formatting

export const fmt = (n: number | null | undefined): string => (n == null ? "-" : Math.round(n).toLocaleString("en-GB"));

export const pct = (n: number | null | undefined): string =>
  n == null ? "-" : `${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1)}%`;

export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86_400)} days ago`;
}

export function bucketLabel(bucket: string, group: string, long = false): string {
  if (group === "month") {
    const [y, m] = bucket.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
      month: long ? "long" : "short",
      year: long ? "numeric" : "2-digit",
      timeZone: "UTC",
    });
  }
  const d = new Date(bucket + "T00:00:00Z");
  if (group === "week") {
    const base = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    return long ? `Week of ${base}` : base;
  }
  return d.toLocaleDateString("en-GB", long ? { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" } : { day: "numeric", month: "short", timeZone: "UTC" });
}

export function seconds(n: number | null | undefined): string {
  if (n == null) return "-";
  return n < 90 ? `${Math.round(n)} s` : `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, "0")}`;
}

function niceScale(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 4, step: 1 };
  const rough = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  return { top: Math.ceil(max / step) * step, step };
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

// Rounded at the top only: 4px data-end, square where it sits on the baseline.
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

// -------------------------------------------------------------- stat tile

export function StatTile({
  label,
  value,
  note,
  delta,
}: {
  label: string;
  value: string;
  note?: string;
  /** current vs previous period; higherIsBetter says whether an increase is good news. */
  delta?: { text: string; direction: "up" | "down" | "flat"; good: boolean } | null;
}) {
  return (
    <div className="an-tile">
      <div className="an-tile-label">{label}</div>
      <div className="an-tile-value">{value}</div>
      {delta && (
        <div className={`an-delta ${delta.direction === "flat" ? "flat" : delta.good ? "good" : "bad"}`}>
          <span aria-hidden="true">{delta.direction === "up" ? "▲" : delta.direction === "down" ? "▼" : "•"}</span> {delta.text}
        </div>
      )}
      {note && <div className="an-tile-note">{note}</div>}
    </div>
  );
}

/** Change against the previous period: a percentage for counts, points for rates. */
export function deltaOf(
  current: number | null | undefined,
  previous: number | null | undefined,
  kind: "count" | "rate",
  higherIsBetter: boolean,
  periodLabel: string
): { text: string; direction: "up" | "down" | "flat"; good: boolean } | null {
  if (current == null || previous == null) return null;
  if (kind === "count") {
    if (previous === 0) return null;
    const change = ((current - previous) / previous) * 100;
    if (Math.abs(change) < 0.5) return { text: `no change vs ${periodLabel}`, direction: "flat", good: true };
    const up = change > 0;
    return { text: `${Math.abs(change).toFixed(0)}% vs ${periodLabel}`, direction: up ? "up" : "down", good: up === higherIsBetter };
  }
  const change = current - previous;
  if (Math.abs(change) < 0.5) return { text: `no change vs ${periodLabel}`, direction: "flat", good: true };
  const up = change > 0;
  return { text: `${Math.abs(change).toFixed(1)} pts vs ${periodLabel}`, direction: up ? "up" : "down", good: up === higherIsBetter };
}

// ------------------------------------------------------------- time chart

export interface Series {
  key: string;
  label: string;
  color: string; // a CSS colour, normally var(--an-...)
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="an-legend">
      {items.map((i) => (
        <span key={i.label}>
          <i style={{ background: i.color }} /> {i.label}
        </span>
      ))}
    </div>
  );
}

/** Stacked columns (several series) or a line with an area wash (one series), one point per day/week/month. */
export function TimeChart({
  data,
  series,
  group,
  kind,
  height = 280,
  label,
}: {
  data: Record<string, any>[];
  series: Series[];
  group: string;
  kind: "stacked" | "line";
  height?: number;
  label: string;
}) {
  const [ref, measured] = useWidth();
  const width = measured || 640;
  const [hover, setHover] = useState<number | null>(null);
  const margin = { l: 46, r: 14, t: 12, b: 28 };
  const innerW = Math.max(40, width - margin.l - margin.r);
  const innerH = height - margin.t - margin.b;
  const n = data.length;
  const band = innerW / Math.max(n, 1);

  const totals = data.map((d) => series.reduce((sum, s) => sum + (Number(d[s.key]) || 0), 0));
  const max = kind === "stacked" ? Math.max(...totals, 0) : Math.max(...data.map((d) => Number(d[series[0].key]) || 0), 0);
  const { top, step } = niceScale(max);
  const y = (v: number) => margin.t + innerH - (v / top) * innerH;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 0.0001; v += step) ticks.push(v);

  const stride = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 70))));
  const barW = Math.min(24, band * 0.7);
  const cx = (i: number) => margin.l + band * (i + 0.5);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - box.left) / box.width) * n);
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const empty = max === 0;
  const points = kind === "line" ? data.map((d, i) => [cx(i), y(Number(d[series[0].key]) || 0)] as const) : [];
  const tipLeft = hover === null ? 0 : cx(hover) > width - 200 ? cx(hover) - 190 : cx(hover) + 14;

  return (
    <div
      className="an-chart"
      ref={ref}
      tabIndex={0}
      role="img"
      aria-label={`${label}. Use the left and right arrow keys to read each ${group}.`}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
        if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
        if (e.key === "Escape") setHover(null);
      }}
      onBlur={() => setHover(null)}
    >
      <svg width={width} height={height} onPointerLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line className="an-grid" x1={margin.l} x2={width - margin.r} y1={y(v)} y2={y(v)} />
            <text className="an-axis" x={margin.l - 8} y={y(v) + 4} textAnchor="end">
              {fmt(v)}
            </text>
          </g>
        ))}
        {data.map((d, i) =>
          i % stride === 0 ? (
            <text key={d.bucket} className="an-axis" x={cx(i)} y={height - 8} textAnchor="middle">
              {bucketLabel(d.bucket, group)}
            </text>
          ) : null
        )}

        {kind === "stacked" &&
          data.map((d, i) => {
            let acc = 0;
            const topSeries = [...series].reverse().find((s) => (Number(d[s.key]) || 0) > 0);
            return (
              <g key={d.bucket}>
                {hover === i && <rect className="an-hover-band" x={margin.l + band * i} y={margin.t} width={band} height={innerH} />}
                {series.map((s) => {
                  const v = Number(d[s.key]) || 0;
                  if (v <= 0) return null;
                  const y0 = y(acc + v);
                  const h = y(acc) - y0;
                  acc += v;
                  // a 2px surface gap separates stacked segments
                  const drawn = Math.max(h - 2, 2);
                  const x = cx(i) - barW / 2;
                  return s === topSeries && drawn >= 4 ? (
                    <path key={s.key} d={topRounded(x, y0 + (h - drawn), barW, drawn, 4)} style={{ fill: s.color }} />
                  ) : (
                    <rect key={s.key} x={x} y={y0 + (h - drawn)} width={barW} height={drawn} style={{ fill: s.color }} />
                  );
                })}
              </g>
            );
          })}

        {kind === "line" && n > 0 && (
          <>
            <path
              d={`M${points[0][0]},${y(0)} ${points.map(([px, py]) => `L${px},${py}`).join(" ")} L${points[n - 1][0]},${y(0)} Z`}
              style={{ fill: series[0].color, opacity: 0.1 }}
            />
            <path
              d={points.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px},${py}`).join(" ")}
              style={{ stroke: series[0].color }}
              className="an-line"
            />
            {hover !== null && <line className="an-crosshair" x1={cx(hover)} x2={cx(hover)} y1={margin.t} y2={margin.t + innerH} />}
            {[hover !== null ? hover : n - 1].map((i) => (
              <circle key="dot" className="an-dot" cx={points[i][0]} cy={points[i][1]} r={4} style={{ fill: series[0].color }} />
            ))}
          </>
        )}
        <line className="an-baseline" x1={margin.l} x2={width - margin.r} y1={y(0)} y2={y(0)} />
        <rect x={margin.l} y={margin.t} width={innerW} height={innerH} fill="transparent" onPointerMove={onMove} />
      </svg>

      {empty && <div className="an-empty-note">Nothing recorded in this period yet.</div>}

      {hover !== null && data[hover] && (
        <div className="an-tip" style={{ left: tipLeft, top: margin.t + 6 }}>
          <div className="an-tip-head">{bucketLabel(data[hover].bucket, group, true)}</div>
          {series.map((s) => (
            <div className="an-tip-row" key={s.key}>
              <i style={{ background: s.color }} />
              <span className="an-tip-name">{s.label}</span>
              <strong>{fmt(Number(data[hover][s.key]) || 0)}</strong>
            </div>
          ))}
          {kind === "stacked" && series.length > 1 && (
            <div className="an-tip-row total">
              <span className="an-tip-name">Total</span>
              <strong>{fmt(totals[hover])}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ horizontal bars

export interface HBarRow {
  key: string;
  label: ReactNode;
  sub?: ReactNode;
  bars: { color: string; value: number; display: string; name: string }[];
  /** shown when hovering the row, under the row's title */
  detail?: string[];
}

export function HBars({ rows, max, unit }: { rows: HBarRow[]; max?: number; unit?: string }) {
  const [tip, setTip] = useState<{ row: HBarRow; x: number; y: number } | null>(null);
  const scale = max ?? Math.max(...rows.flatMap((r) => r.bars.map((b) => b.value)), 1);
  const onMove = (row: HBarRow, e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.parentElement!.getBoundingClientRect();
    setTip({ row, x: e.clientX - box.left, y: e.clientY - box.top });
  };
  return (
    <div className="an-hbars" onPointerLeave={() => setTip(null)}>
      {rows.map((row) => (
        <div
          className="an-hrow"
          key={row.key}
          tabIndex={0}
          onPointerMove={(e) => onMove(row, e)}
          onFocus={(e) => {
            const box = e.currentTarget.parentElement!.getBoundingClientRect();
            const r = e.currentTarget.getBoundingClientRect();
            setTip({ row, x: 220, y: r.top - box.top + r.height });
          }}
          onBlur={() => setTip(null)}
        >
          <div className="an-hlabel">
            <span>{row.label}</span>
            {row.sub && <small>{row.sub}</small>}
          </div>
          <div className="an-hlines">
            {row.bars.map((b) => (
              <div className="an-hline" key={b.name}>
                <div className="an-htrack">
                  <div className="an-hfill" style={{ width: `${Math.max(0, Math.min(100, (b.value / scale) * 100))}%`, background: b.color }} />
                </div>
                <span className="an-hval" style={{ left: `calc((100% - 110px) * ${Math.max(0, Math.min(1, b.value / scale))} + 8px)` }}>
                  {b.display}
                  {unit ? ` ${unit}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {tip && (
        <div className="an-tip" style={{ left: Math.min(tip.x + 14, 420), top: tip.y + 14 }}>
          <div className="an-tip-head">{tip.row.label}</div>
          {tip.row.bars.map((b) => (
            <div className="an-tip-row" key={b.name}>
              <i style={{ background: b.color }} />
              <span className="an-tip-name">{b.name}</span>
              <strong>{b.display}</strong>
            </div>
          ))}
          {tip.row.detail?.map((d) => (
            <div className="an-tip-detail" key={d}>
              {d}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- table

export interface Col<T> {
  key: string;
  label: string;
  align?: "left" | "right";
  /** the sortable / exportable value */
  value: (row: T) => string | number | null;
  render?: (row: T) => ReactNode;
  help?: string;
}

/** A thin bar beside a percentage, for rate columns. */
export function RateCell({ value, color = "var(--an-bar)" }: { value: number | null; color?: string }) {
  if (value == null) return <span className="an-dim">-</span>;
  return (
    <span className="an-rate">
      <span className="an-rate-track">
        <span style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color }} />
      </span>
      <span>{pct(value)}</span>
    </span>
  );
}

export function DataTable<T>({
  rows,
  cols,
  initialSort,
  filename,
  searchText,
  empty,
  pageSize = 15,
}: {
  rows: T[];
  cols: Col<T>[];
  initialSort?: { key: string; dir: "asc" | "desc" };
  filename: string;
  searchText?: (row: T) => string;
  empty: string;
  pageSize?: number;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = q && searchText ? rows.filter((r) => searchText(r).toLowerCase().includes(q)) : rows;
    const col = sort && cols.find((c) => c.key === sort.key);
    if (col && sort) {
      list = [...list].sort((a, b) => {
        const av = col.value(a);
        const bv = col.value(b);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return list;
  }, [rows, cols, sort, query, searchText]);

  const shown = showAll ? sorted : sorted.slice(0, pageSize);

  const download = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [cols.map((c) => esc(c.label)).join(","), ...sorted.map((r) => cols.map((c) => esc(c.value(r))).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (rows.length === 0) return <p className="an-dim an-empty">{empty}</p>;

  return (
    <div className="an-table-wrap">
      <div className="an-table-tools">
        {searchText && (
          <input type="search" placeholder="Search..." value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search this table" />
        )}
        <span className="an-dim">
          {sorted.length} row{sorted.length === 1 ? "" : "s"}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={download}>
          Download CSV
        </button>
      </div>
      <div className="an-table-scroll">
        <table className="an-table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={c.align === "right" ? "right" : undefined}
                  title={c.help}
                  aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <button
                    className="an-th"
                    onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === "desc" ? "asc" : "desc" } : { key: c.key, dir: "desc" }))}
                  >
                    {c.label}
                    <span aria-hidden="true">{sort?.key === c.key ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c.key} className={c.align === "right" ? "right" : undefined}>
                    {c.render ? c.render(r) : (c.value(r) ?? "-")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > pageSize && (
        <button className="btn an-more" onClick={() => setShowAll((s) => !s)}>
          {showAll ? "Show fewer" : `Show all ${sorted.length}`}
        </button>
      )}
    </div>
  );
}
