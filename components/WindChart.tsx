// Minimal dependency-free SVG line chart for the last ~24 h of wind + gusts.

interface Point {
  time: string;
  windKt: number | null;
  gustKt: number | null;
}

const TZ = "America/Chicago";

export function WindChart({ data }: { data: Point[] }) {
  const pts = data.filter((d) => d.windKt != null);
  if (pts.length < 2) {
    return <div className="grid h-40 place-items-center text-sm text-slate-500">No recent wind observations.</div>;
  }

  const W = 640;
  const H = 180;
  const padL = 28;
  const padB = 20;
  const padT = 10;
  const maxKt = Math.max(12, ...pts.map((p) => Math.max(p.windKt ?? 0, p.gustKt ?? 0))) * 1.1;

  const x = (i: number) => padL + (i / (pts.length - 1)) * (W - padL - 6);
  const y = (v: number) => padT + (1 - v / maxKt) * (H - padT - padB);

  const line = (key: "windKt" | "gustKt") =>
    pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[key] ?? 0).toFixed(1)}`)
      .join(" ");

  const gridVals = [0, Math.round(maxKt / 2), Math.round(maxKt)];
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: true }).format(new Date(iso));

  const ticks = [0, Math.floor((pts.length - 1) / 2), pts.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Wind speed over the last 24 hours">
      {gridVals.map((v) => (
        <g key={v}>
          <line x1={padL} x2={W - 6} y1={y(v)} y2={y(v)} stroke="rgba(148,163,184,0.15)" />
          <text x={4} y={y(v) + 3} fontSize={10} fill="#64748b">{v}</text>
        </g>
      ))}
      <path d={line("gustKt")} fill="none" stroke="rgba(56,189,248,0.35)" strokeWidth={1.5} strokeDasharray="3 3" />
      <path d={line("windKt")} fill="none" stroke="#38bdf8" strokeWidth={2} />
      {ticks.map((i) => (
        <text key={i} x={x(i)} y={H - 4} fontSize={10} fill="#64748b" textAnchor="middle">
          {fmt(pts[i].time)}
        </text>
      ))}
      <text x={W - 6} y={padT + 8} fontSize={10} fill="#38bdf8" textAnchor="end">kt</text>
    </svg>
  );
}
