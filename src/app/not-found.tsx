import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-[var(--page-bg)] px-6 py-12">
      <div className="w-full max-w-[420px] rounded-[24px] bg-[var(--surface)] p-8 text-center shadow-[0_12px_36px_rgba(0,0,0,0.08)]">
        <p className="text-[42px] font-semibold tracking-[-0.04em] text-[var(--text-secondary)]">404</p>
        <h1 className="mt-2 text-[22px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
          没有找到这个页面
        </h1>
        <p className="mt-2 text-[14px] leading-6 text-[var(--text-secondary)]">
          链接可能已过期、被撤销，或页面已经移动。
        </p>
        <Link href="/" className="btn-primary mt-6 inline-flex items-center justify-center">
          返回首页
        </Link>
      </div>
    </main>
  );
}
