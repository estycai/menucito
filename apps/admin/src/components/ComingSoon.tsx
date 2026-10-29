/** Placeholder for panel sections that do not exist yet. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-5">
      <h1 className="m-0 font-display text-[28px] font-extrabold sm:text-[32px]">{title}</h1>
      <section className="flex flex-col gap-1.5 rounded-2xl border border-line bg-white p-6">
        <h2 className="m-0 font-display text-xl font-extrabold">Próximamente</h2>
        <p className="m-0 text-[15px] text-muted">Estamos trabajando en esta sección.</p>
      </section>
    </div>
  );
}
