/** 公开页面的限流提示，避免把暂时限流误报为链接永久失效。 */
export function ShareLookupNotice({ retryAfter }: { retryAfter: number }) {
  return <main className="flex min-h-svh items-center justify-center bg-[var(--page-bg)] px-6">
    <p role="status" className="type-body text-[var(--text-secondary)]">访问过于频繁，请 {retryAfter} 秒后刷新重试。</p>
  </main>;
}
