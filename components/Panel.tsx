export function Panel({
  title,
  right,
  className = "",
  children,
}: {
  title?: string;
  right?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-4 ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}
