import Link from "next/link";
import { headers } from "next/headers";
import { requireSession } from "@/features/session/session";

const ICON_BACK = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="h-[15px] w-[15px]"
  >
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

export default async function ApiUsagePage() {
  await requireSession();

  // 站点 origin：curl 示例用（host 头即用户访问的域名）
  const hs = await headers();
  const host = hs.get("x-forwarded-host") ?? hs.get("host") ?? "";
  const proto = hs.get("x-forwarded-proto") ?? "http";
  const origin = host ? `${proto}://${host}` : "https://你的域名";

  const uploadExample = `curl -X POST ${origin}/api/v1/reports \\
  -H "Authorization: Bearer sgk_你的令牌" \\
  -F "title=周报 8 月" \\
  -F "date=2026-08-25" \\
  -F "tag=汇报" \\
  -F "file=@report.zip"`;

  const replaceExample = `curl -X PATCH ${origin}/api/v1/reports/r_ab12cd34 \\
  -H "Authorization: Bearer sgk_你的令牌" \\
  -F "title=周报 8 月 v2" \\
  -F "date=2026-08-25" \\
  -F "file=@report-new.zip"`;

  return (
    <main className="min-h-svh bg-[var(--page-bg)] text-[var(--text-primary)] antialiased">
      <div className="account-shell">
        {/* 页头 + 右侧返回（与指南页同一视觉轴） */}
        <div className="mb-[42px] flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="type-page-title tracking-[-0.02em] text-[var(--text-primary)]">
              API 上传使用说明
            </h1>
            <p className="mt-2 type-body text-[var(--text-secondary)]">
              在命令行、脚本或 AI 工具中直接上传汇报文件。
            </p>
          </div>
          <Link href="/account" className="btn-light shrink-0">
            {ICON_BACK}
            返回
          </Link>
        </div>

        {/* 1 快速开始 */}
        <section className="mb-7 rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--surface)] px-9 py-9 shadow-[0_1px_2px_rgba(0,0,0,0.015),0_10px_30px_rgba(0,0,0,0.018)] md:px-14">
          <h2 className="type-section-title tracking-[-0.01em] text-[var(--text-primary)]">
            快速开始
          </h2>
          <ol className="mt-5 flex list-none flex-col gap-3.5">
            {[
              "在「账号与安全 → API 令牌」新建令牌（每账号一个），点眼睛图标可随时查看、一键复制。",
              "把要上传的文件准备好：单个 report.html，或含 report.html 的 zip 压缩包。",
              "用下面的命令上传，成功后返回 {\"ok\":true,\"slug\":\"r_xxxxxxxx\"}。",
            ].map((t, i) => (
              <li key={i} className="flex items-start gap-3 type-body text-[var(--text-primary)]">
                <span className="mt-[2px] flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full bg-[var(--accent)] type-badge text-[var(--text-on-fill)]">
                  {i + 1}
                </span>
                {t}
              </li>
            ))}
          </ol>
        </section>

        {/* 2 接口详情 */}
        <section className="mb-7 rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--surface)] px-9 py-9 shadow-[0_1px_2px_rgba(0,0,0,0.015),0_10px_30px_rgba(0,0,0,0.018)] md:px-14">
          <h2 className="type-section-title tracking-[-0.01em] text-[var(--text-primary)]">
            接口详情
          </h2>

          <h3 className="mt-7 type-subtitle text-[var(--text-primary)]">
            上传新汇报
          </h3>
          <p className="mt-1.5 type-caption text-[var(--text-secondary)]">
            POST /api/v1/reports
          </p>
          <div className="mt-3 overflow-x-auto rounded-[var(--radius-md)] bg-[var(--surface-sunken)] px-5 py-4">
            <pre className="m-0 whitespace-pre font-mono type-code text-[var(--text-primary)]">
              {uploadExample}
            </pre>
          </div>

          <h3 className="mt-8 type-subtitle text-[var(--text-primary)]">
            替换已有汇报的文件
          </h3>
          <p className="mt-1.5 type-caption text-[var(--text-secondary)]">
            PATCH /api/v1/reports/&lt;slug&gt;（slug 是上传返回的编号；file
            可省略，省略则只更新信息）
          </p>
          <div className="mt-3 overflow-x-auto rounded-[var(--radius-md)] bg-[var(--surface-sunken)] px-5 py-4">
            <pre className="m-0 whitespace-pre font-mono type-code text-[var(--text-primary)]">
              {replaceExample}
            </pre>
          </div>

          <h3 className="mt-8 type-subtitle text-[var(--text-primary)]">
            请求字段
          </h3>
          <div className="mt-3 flex flex-col gap-2">
            {[
              { f: "title", req: true, d: "汇报名称，最长 20 字（汉字算 1、字母算 0.5）" },
              { f: "date", req: true, d: "汇报日期，格式 YYYY-MM-DD" },
              { f: "file", req: true, d: "report.html 或 zip 压缩包，最大 50MB；zip 解压后 ≤100MB、≤50 个文件、≤5 层目录" },
              { f: "displayMode", req: false, d: "展示模式：frame（默认，带平台汇报外壳）或 bare（网页发布，无外壳、新标签打开）；省略时新建默认 frame、更新保留原模式" },
              { f: "tag", req: false, d: "标签，最长 6 字" },
              { f: "tagColor", req: false, d: "标签颜色（色板值，可选）" },
              { f: "description", req: false, d: "简介，最长 200 字" },
              { f: "keywords", req: false, d: "关键词，最长 50 字" },
            ].map((r) => (
              <div key={r.f} className="flex flex-col gap-1 sm:flex-row sm:gap-5">
                <code className="w-[110px] shrink-0 font-mono type-code text-[var(--text-primary)]">
                  {r.f}
                  {r.req && <span className="ml-0.5 text-[var(--danger-text)]">*</span>}
                </code>
                <span className="type-caption text-[var(--text-secondary)]">
                  {r.d}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* 3 注意事项 */}
        <section className="rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--surface)] px-9 py-9 shadow-[0_1px_2px_rgba(0,0,0,0.015),0_10px_30px_rgba(0,0,0,0.018)] md:px-14">
          <h2 className="type-section-title tracking-[-0.01em] text-[var(--text-primary)]">
            注意事项
          </h2>
          <div className="mt-5 flex flex-col gap-3 type-body text-[var(--text-secondary)]">
            <p>令牌在令牌卡片中默认打码显示，点眼睛图标可随时查看明文或一键复制；疑似泄露时点「更换令牌」即可让旧值立即失效。</p>
            <p>配额与网页上传共享：个人总存储 2GB，全站 20GB。</p>
            <p>请求频率限制：每分钟 30 次；认证失败 10 分钟内最多 20 次后会暂时锁定。</p>
          </div>
        </section>
      </div>
    </main>
  );
}
