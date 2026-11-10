import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatAxisMoney, formatCount, formatMoney } from "@/lib/reports";

const PRIMARY = "var(--color-primary)";
const GRID = "var(--color-line-soft)";
const MUTED = "var(--color-muted)";

export interface TopChartProps {
  data: { name: string; value: number }[];
  money: boolean;
}

const MAX_LABEL = 16;

/** A long product name cut with "…" so the axis never runs out of the card (the tooltip keeps it whole). */
export const shortLabel = (name: string) => (name.length > MAX_LABEL ? `${name.slice(0, MAX_LABEL - 1).trimEnd()}…` : name);

/** Horizontal bars of the Top 10; loaded lazily inside /reportes. */
export function TopChart({ data, money }: TopChartProps) {
  const format = (value: number) => (money ? formatMoney(value) : formatCount(value));
  const axis = { stroke: MUTED, fontSize: 11 };
  return (
    <div role="img" aria-label="Top 10 de productos">
      <ResponsiveContainer width="100%" height={Math.max(220, data.length * 34)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" tick={axis} tickFormatter={(value: number) => (money ? formatAxisMoney(value) : formatCount(value))} />
          <YAxis type="category" dataKey="name" width={112} tick={axis} interval={0} tickFormatter={shortLabel} />
          <Tooltip formatter={(value: unknown) => format(Number(value))} />
          <Bar dataKey="value" fill={PRIMARY} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
