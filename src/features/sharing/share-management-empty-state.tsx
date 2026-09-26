export function ShareManagementEmptyState({
  title,
  hint,
}: {
  title: string;
  hint: string;
}) {
  return (
    <div className="flex min-h-[154px] flex-col items-center justify-center rounded-[20px] bg-[var(--surface)] px-6 py-10 text-center shadow-[0_8px_28px_rgba(0,0,0,0.025)]">
      <p className="text-[15px] font-semibold">{title}</p>
      <p className="mt-2 text-[13px] leading-[1.6] text-[var(--text-secondary)]">{hint}</p>
    </div>
  );
}
