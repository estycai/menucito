import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TrendComparison, TrendView } from "@/lib/report-series";
import { formatAxisMoney, formatCount, formatMoney } from "@/lib/reports";

const PRIMARY = "var(--color-primary)";
const ACCENT = "var(--color-accent)";
const INFO = "var(--color-info)";
const GRID = "var(--color-line-soft)";
const MUTED = "var(--color-muted)";

export interface TrendChartProps {
  labels: string[];
  current: number[];
  previous: number[];
  year: number[];
  average: number[];
  delivery: number[];
  takeaway: number[];
  view: TrendView;
  comparison: TrendComparison;
  money: boolean;
  metricLabel: string;
}

/** Bars and lines of "Evolución de ventas"; loaded lazily inside /reportes. */
export function TrendChart(props: TrendChartProps) {
  const data = props.labels.map((label, index) => ({
    label,
    current: props.current[index] ?? 0,
    previous: props.previous[index] ?? 0,
    year: props.year[index] ?? 0,
    average: props.average[index] ?? 0,
    delivery: props.delivery[index] ?? 0,
    takeaway: props.takeaway[index] ?? 0,
  }));
  const format = (value: number) => (props.money ? formatMoney(value) : formatCount(value));
  const tooltip = (value: unknown) => format(Number(value));
  const tick = (value: number) => (props.money ? formatAxisMoney(value) : formatCount(value));
  const legend = <Legend verticalAlign="top" height={28} iconType="circle" wrapperStyle={{ fontSize: 12 }} />;
  const axis = { stroke: MUTED, fontSize: 11 };
  const reference = props.comparison === "year" ? "year" : "previous";
  const referenceName = props.comparison === "year" ? "Año pasado" : "Período anterior";

  return (
    <div role="img" aria-label={`Gráfico de ${props.metricLabel}`}>
      <ResponsiveContainer width="100%" height={280}>
        {props.view === "trend" ? (
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={axis} minTickGap={24} interval="preserveStartEnd" />
            <YAxis tick={axis} width={props.money ? 84 : 48} tickFormatter={tick} />
            <Tooltip formatter={tooltip} />
            {legend}
            <Line type="monotone" dataKey="current" name="Este período" stroke={PRIMARY} strokeWidth={2.4} dot={false} />
            <Line type="monotone" dataKey="average" name="Media móvil (7)" stroke={ACCENT} strokeWidth={1.8} strokeDasharray="5 4" dot={false} />
          </LineChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={axis} minTickGap={24} interval="preserveStartEnd" />
            <YAxis tick={axis} width={props.money ? 84 : 48} tickFormatter={tick} />
            <Tooltip formatter={tooltip} />
            {props.view === "simple" && <Bar dataKey="current" name="Este período" fill={PRIMARY} radius={[4, 4, 0, 0]} />}
            {props.view === "compare" && (
              <>
                {legend}
                <Bar dataKey="current" name="Este período" fill={PRIMARY} radius={[4, 4, 0, 0]} />
                {/* The reference period goes lighter, as the spec asks ("--color-accent aclarado"). */}
                <Bar dataKey={reference} name={referenceName} fill={ACCENT} fillOpacity={0.45} radius={[4, 4, 0, 0]} />
              </>
            )}
            {props.view === "fulfillment" && (
              <>
                {legend}
                <Bar dataKey="delivery" name="Delivery" stackId="modality" fill={PRIMARY} />
                <Bar dataKey="takeaway" name="Take away" stackId="modality" fill={INFO} radius={[4, 4, 0, 0]} />
              </>
            )}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

export interface DonutDatum {
  name: string;
  value: number;
}

/** Doughnut of the billed amount (or the orders) by payment method. */
export function DonutChart({ data, money }: { data: DonutDatum[]; money: boolean }) {
  const colors = [PRIMARY, INFO];
  return (
    <div role="img" aria-label="Distribución por medio de pago">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
            {data.map((entry, index) => (
              <Cell key={entry.name} fill={colors[index % colors.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value: unknown) => (money ? formatMoney(Number(value)) : formatCount(Number(value)))} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
