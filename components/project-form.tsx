"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CardHead } from "@/components/card-head";
import { DatePicker } from "@/components/date-picker";
import { LIMITS, charWeight } from "@/lib/char-limit";

export type ProjectFormValues = {
  title: string;
  date: string;
  tag: string;
  keywords: string;
  description: string;
};

const ICON_INFO = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[19px] w-[19px]">
    <path d="M7 3h8l4 4v14H7z" />
    <path d="M15 3v4h4" />
    <path d="M10 12h6M10 16h6" />
  </svg>
);

const ICON_TAG = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[19px] w-[19px]">
    <path d="M3 11V4a1 1 0 0 1 1-1h7l10 10-8 8L3 11Z" />
    <circle cx="8" cy="8" r="1.5" />
  </svg>
);

const ICON_DESC = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[19px] w-[19px]">
    <path d="M4 6h16M4 12h16M4 18h10" />
  </svg>
);

const ICON_FILE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[19px] w-[19px]">
    <path d="M12 16V4m0 0 4 4m-4-4-4 4" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </svg>
);

const ICON_CHEVRON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-[14px] w-[14px]">
    <path d="m9 6 6 6-6 6" />
  </svg>
);

type Errors = {
  title?: string;
  date?: string;
  tag?: string;
  keywords?: string;
  description?: string;
  file?: string;
};

function formatSize(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

/**
 * 超限错误文案：输入时实时提示与提交拦截共用同一口径。
 * 名称/关键词/简介按字宽（汉字 1、半角 0.5），标签按字数。
 */
function fieldLimitError(
  field: "title" | "tag" | "keywords" | "description",
  v: string,
): string | undefined {
  switch (field) {
    case "title":
      return charWeight(v) > LIMITS.title
        ? `名称最长 ${LIMITS.title} 字`
        : undefined;
    case "tag":
      return v.trim().length > LIMITS.tag
        ? `标签最长 ${LIMITS.tag} 字`
        : undefined;
    case "keywords":
      return charWeight(v) > LIMITS.keywords
        ? `关键词最长 ${LIMITS.keywords} 字`
        : undefined;
    case "description":
      return charWeight(v) > LIMITS.description
        ? `简介最长 ${LIMITS.description} 字`
        : undefined;
  }
}

/**
 * 新建 / 编辑项目共用的整页表单。
 * requireFile=true（新建）：必须上传 ZIP；
 * requireFile=false（编辑）：保留原报告，可选更换。
 * onSubmit 返回错误文案（显示在报告文件卡内），成功返回 null 并自行跳转。
 */
export function ProjectForm({
  heading,
  headingDesc,
  initial,
  requireFile,
  submitLabel,
  submittingLabel,
  onSubmit,
}: {
  heading: string;
  headingDesc: string;
  initial?: Partial<ProjectFormValues>;
  requireFile: boolean;
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (
    values: ProjectFormValues,
    file: File | null,
  ) => Promise<string | null>;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(
    () => initial?.date ?? new Date().toISOString().slice(0, 10),
  );
  const [tag, setTag] = useState(initial?.tag ?? "");
  const [keywords, setKeywords] = useState(initial?.keywords ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  // 指南入口带来源路径：从指南返回时回到当前页（新建/编辑），而不是固定回首页
  const pathname = usePathname();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 上传文件类型：zip 压缩包（含 report.html 及辅助文件）或单个 HTML 文件
  function fileKind(f: File): "zip" | "html" | null {
    if (/\.zip$/i.test(f.name) || f.type === "application/zip") return "zip";
    if (/\.(html?|xhtml)$/i.test(f.name) || f.type === "text/html") {
      return "html";
    }
    return null;
  }

  function acceptFile(f: File | null | undefined) {
    if (!f) return;
    if (!fileKind(f)) {
      setFile(null);
      setErrors((p) => ({ ...p, file: "请选择 ZIP 压缩包或 HTML 文件" }));
      return;
    }
    setFile(f);
    setErrors((p) => ({ ...p, file: undefined }));
  }

  function openPicker() {
    fileInputRef.current?.click();
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;

    const next: Errors = {};
    if (!title.trim()) next.title = "请输入项目名称";
    if (!date) next.date = "请选择日期";
    // 长度超限：输入时已实时提示，这里统一拦截提交（含程序化绕过）
    next.title ??= fieldLimitError("title", title);
    next.tag ??= fieldLimitError("tag", tag);
    next.keywords ??= fieldLimitError("keywords", keywords);
    next.description ??= fieldLimitError("description", description);
    if (requireFile && !file) next.file = "请上传报告文件（ZIP 或 HTML）";
    setErrors(next);
    if (next.title || next.date || next.tag || next.keywords || next.description || next.file)
      return;

    setLoading(true);
    try {
      const err = await onSubmit(
        {
          title: title.trim(),
          date,
          tag: tag.trim(),
          keywords: keywords.trim(),
          description: description.trim(),
        },
        file,
      );
      if (err) setErrors({ file: err });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-svh bg-[#f5f5f7] text-[#1d1d1f] antialiased">
      <div className="account-shell">
        {/* 页头 + 右侧返回（与账号页 / Home 同一视觉轴） */}
        <div className="mb-[42px] flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[32px] font-bold leading-[1.15] tracking-[-0.02em] text-[#1d1d1f]">
              {heading}
            </h1>
            <p className="mt-2 text-[15px] leading-[1.5] text-[#6e6e73]">
              {headingDesc}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <Link href={`/guide?from=${encodeURIComponent(pathname)}`} className="btn-light">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                className="h-[15px] w-[15px]"
              >
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 0 4 5.5v14z" />
                <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
              </svg>
              制作指南
            </Link>
            <Link href="/home" className="btn-light">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-[15px] w-[15px]"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
              返回
            </Link>
          </div>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="project-grid">
            {/* ── 基本信息 ── */}
            <section className="project-card">
              <CardHead icon={ICON_INFO} title="基本信息" desc="建立项目的基础信息" />
              <div className="project-field">
                <label className="project-label" htmlFor="np-title">
                  项目名称<span className="project-req">*</span>
                </label>
                <input
                  id="np-title"
                  type="text"
                  placeholder={`例如：市场调研项目（${LIMITS.title} 字内）`}
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setErrors((p) => ({
                      ...p,
                      title: fieldLimitError("title", e.target.value),
                    }));
                  }}
                  className="project-input"
                />
                {/* 错误槽常驻：报错出现/消失时下方字段零位移 */}
                <p className="project-error">{errors.title ?? ""}</p>
              </div>
              <div className="project-field">
                <span className="project-label">
                  日期<span className="project-req">*</span>
                </span>
                <DatePicker
                  value={date}
                  onChange={(v) => {
                    setDate(v);
                    if (errors.date) setErrors((p) => ({ ...p, date: undefined }));
                  }}
                  error={!!errors.date}
                />
              </div>
            </section>

            {/* ── 分类与检索 ── */}
            <section className="project-card">
              <CardHead icon={ICON_TAG} title="分类与检索" desc="帮助项目后续整理与搜索" />
              <div className="project-field">
                <label className="project-label" htmlFor="np-tag">
                  标签
                </label>
                <input
                  id="np-tag"
                  type="text"
                  placeholder={`例如：调研（${LIMITS.tag} 字内）`}
                  value={tag}
                  onChange={(e) => {
                    setTag(e.target.value);
                    setErrors((p) => ({
                      ...p,
                      tag: fieldLimitError("tag", e.target.value),
                    }));
                  }}
                  className="project-input"
                />
                {/* 与左侧名称错误槽同结构同高：超长等错误落在此处，同时保证关键词框与日期框对齐 */}
                <p className="project-error">{errors.tag ?? ""}</p>
              </div>
              <div className="project-field">
                <label className="project-label" htmlFor="np-keywords">
                  关键词
                </label>
                <input
                  id="np-keywords"
                  type="text"
                  placeholder={`例如：市场, 用户, 增长（${LIMITS.keywords} 字内）`}
                  value={keywords}
                  onChange={(e) => {
                    setKeywords(e.target.value);
                    setErrors((p) => ({
                      ...p,
                      keywords: fieldLimitError("keywords", e.target.value),
                    }));
                  }}
                  className="project-input"
                />
                {/* 错误槽常驻：与左侧日期位对应，报错零位移 */}
                <p className="project-error">{errors.keywords ?? ""}</p>
              </div>
            </section>

            {/* ── 项目简介 ── */}
            <section className="project-card">
              <CardHead icon={ICON_DESC} title="项目简介" desc="简要说明这个项目的背景和内容" />
              <div className="project-field">
                <label className="project-label" htmlFor="np-desc">
                  项目说明
                </label>
                <textarea
                  id="np-desc"
                  placeholder={`简单描述项目背景、目的和主要内容…（${LIMITS.description} 字内）`}
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setErrors((p) => ({
                      ...p,
                      description: fieldLimitError("description", e.target.value),
                    }));
                  }}
                  className="project-input"
                />
                {/* 错误槽常驻：卡片 min-height 280 内有足够余量，零位移 */}
                <p className="project-error">{errors.description ?? ""}</p>
              </div>
            </section>

            {/* ── 报告文件 ── */}
            <section className="project-card">
              <CardHead
                icon={ICON_FILE}
                title="报告文件"
                desc={
                  requireFile
                    ? "上传报告压缩包（ZIP）或单个 HTML 文件"
                    : "保留原报告，或更换新的 ZIP / HTML 文件"
                }
              />

              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,.html,.htm,application/zip,text/html"
                className="sr-only"
                onChange={(e) => acceptFile(e.target.files?.[0])}
              />

              {!file ? (
                requireFile ? (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={openPicker}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openPicker();
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDrag(true);
                    }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDrag(false);
                      acceptFile(e.dataTransfer.files?.[0]);
                    }}
                    className={`upload-zone ${drag ? "upload-zone-drag" : ""}`}
                  >
                    <span className="text-[#86868b]">{ICON_FILE}</span>
                    <span className="upload-title">选择 ZIP 或 HTML 文件</span>
                    <span className="upload-hint">
                      拖拽到此处 · ZIP 需含 report.html；单个 HTML 可直接上传
                    </span>
                  </div>
                ) : (
                  <div className="file-state">
                    <div className="file-state-row">
                    <span className="file-badge">FILE</span>
                    <div className="min-w-0">
                      <p className="file-name">当前报告已上传</p>
                      <p className="file-size">不更换则保留原报告文件</p>
                    </div>
                  </div>
                    <div className="file-swap">
                      <button
                        type="button"
                        onClick={() => {
                          if (fileInputRef.current) fileInputRef.current.value = "";
                          openPicker();
                        }}
                        className="btn-action"
                      >
                        更换文件
                        {ICON_CHEVRON}
                      </button>
                    </div>
                  </div>
                )
              ) : (
                <div className="file-state">
                  <div className="file-state-row">
                    <span className="file-badge">
                      {fileKind(file) === "html" ? "HTML" : "ZIP"}
                    </span>
                    <div className="min-w-0">
                      <p className="file-name">{file.name}</p>
                      <p className="file-size">{formatSize(file.size)} MB</p>
                    </div>
                  </div>
                  <p className="file-check">
                    ✓ 已选择 · 上传时将自动校验
                    {fileKind(file) === "html" ? "" : "（ZIP 需含 report.html）"}
                  </p>
                  <div className="file-swap">
                    {!requireFile && (
                      <button
                        type="button"
                        onClick={() => {
                          setFile(null);
                          if (fileInputRef.current) fileInputRef.current.value = "";
                        }}
                        className="btn-action"
                      >
                        取消更换
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (fileInputRef.current) fileInputRef.current.value = "";
                        openPicker();
                      }}
                      className="btn-action"
                    >
                      更换文件
                      {ICON_CHEVRON}
                    </button>
                  </div>
                </div>
              )}

              {/* 错误槽位常驻（上传框下方、左对齐）：报错出现时布局零位移 */}
              <div className="upload-error-slot" role="alert">
                {errors.file}
              </div>
            </section>
          </div>

          {/* 页面级 Action Row */}
          <div className="page-actions">
            <Link href="/home" className="btn-cancel-page">
              取消
            </Link>
            <button type="submit" disabled={loading} className="btn-create">
              {loading && <span className="spinner" aria-hidden />}
              {loading ? submittingLabel : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
