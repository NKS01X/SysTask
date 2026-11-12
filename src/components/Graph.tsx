import { HISTORY } from "../util";

interface Series {
  data: number[];
  color: string;
}

interface Props {
  label: string;
  value: string;
  series: Series[];
  /** Fixed y max; autoscaled when omitted. */
  max?: number;
  height?: number;
}

const W = 240;

export default function Graph({ label, value, series, max, height = 56 }: Props) {
  const peak = max ?? Math.max(1, ...series.flatMap((s) => s.data));
  const step = W / (HISTORY - 1);
  const pts = (data: number[]) =>
    data
      .map((v, i) => {
        const x = W - (data.length - 1 - i) * step;
        const y = height - (Math.min(v, peak) / peak) * height;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  return (
    <div className="graph">
      <div className="meter-head">
        <span>{label}</span>
        <span className="muted">{value}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height }}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            className="grid"
            x1={0}
            x2={W}
            y1={height * f}
            y2={height * f}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {series.map((s, i) =>
          s.data.length > 1 ? (
            <g key={i}>
              {i === 0 && (
                <polygon
                  points={`${W - (s.data.length - 1) * step},${height} ${pts(s.data)} ${W},${height}`}
                  fill={s.color}
                  fillOpacity={0.15}
                />
              )}
              <polyline
                points={pts(s.data)}
                fill="none"
                stroke={s.color}
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ) : null
        )}
      </svg>
    </div>
  );
}
