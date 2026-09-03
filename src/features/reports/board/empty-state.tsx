// 统一空状态：线性图标 + 主句 + 副句（苹果式空状态范式，
// 与全站线性 SVG 图标同一语言，替代 emoji 与纯文字两种旧形态）

const ICONS = {
  // 空项目
  doc: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </>
  ),
  // 搜索无结果
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  // 暂无分享链接
  share: (
    <>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8.2 10.8 15.8 7.2M8.2 13.2l7.6 3.6" />
    </>
  ),
} as const;

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: keyof typeof ICONS;
  title: string;
  hint?: string;
}) {
  return (
    <div className="py-16 text-center">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="mx-auto mb-4 h-[46px] w-[46px] text-[#b0b0b5]"
      >
        {ICONS[icon]}
      </svg>
      <p className="text-[15px] font-medium text-[#1d1d1f]">{title}</p>
      {hint && (
        <p className="mt-1.5 text-[13px] leading-normal text-[#6e6e73]">{hint}</p>
      )}
    </div>
  );
}
