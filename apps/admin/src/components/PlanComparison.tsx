import { planComparison, type ComparisonCell } from "@/lib/plans";

function Cell({ value, label }: { value: ComparisonCell; label: string }) {
  if (value === true) {
    return (
      <span className="font-bold text-primary">
        <span aria-hidden="true">✓</span>
        <span className="sr-only">{label}: incluido</span>
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="text-switch-off">
        <span aria-hidden="true">✕</span>
        <span className="sr-only">{label}: no incluido</span>
      </span>
    );
  }
  if (value === "soon") {
    return <span className="rounded-full bg-warning-soft px-2.5 py-1 text-xs font-bold text-warning">Próximamente</span>;
  }
  return <span>{value.text}</span>;
}

/** Table that compares Free and Premium feature by feature. */
export function PlanComparison() {
  return (
    <section aria-labelledby="plan-compare" className="flex flex-col gap-4">
      <h2 id="plan-compare" className="m-0 font-display text-[26px] font-bold">
        Compará los planes
      </h2>
      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[560px] border-collapse text-left text-[15px]">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="px-6 py-4 text-sm font-normal text-muted">
                Funciones
              </th>
              <th scope="col" className="px-6 py-4 font-bold">
                Free
              </th>
              <th scope="col" className="px-6 py-4 font-bold text-primary">
                Premium
              </th>
            </tr>
          </thead>
          <tbody>
            {planComparison().map((row) => (
              <tr key={row.label} className="border-b border-line-soft last:border-b-0">
                <th scope="row" className="px-6 py-4 font-normal">
                  {row.label}
                </th>
                <td className="px-6 py-4">
                  <Cell value={row.free} label={`${row.label}, Free`} />
                </td>
                <td className="px-6 py-4">
                  <Cell value={row.premium} label={`${row.label}, Premium`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
