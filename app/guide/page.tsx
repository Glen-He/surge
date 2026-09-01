"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

// 汇报页制作指南：从 Home 页头 / 新建项目页进入
// 视觉与 account-shell 体系一致（1080px 轨道、白卡 22px 圆角）；
// 主题色用苹果官网按钮蓝 #0071e3（全站主操作按钮/聚焦色统一同款）

const PROMPT = `请根据我提供的工作材料，制作一份可上传到汇报平台的 HTML 数据汇报。先理解材料、汇报目的和读者，再选择合适的信息结构与视觉表达；材料不足时先向我确认，不得编造材料之外的数据。

一、设计边界
除下方明确写明的平台外壳、运行环境和交付要求外，页面内部设计不设统一模板。卡片内部的内容组织、列数、层级、内嵌元素的 padding 与间距、字号、配色、编号方式、图表类型、图例位置和交互方式，都由你根据材料自由决定。不要为了套用固定版式而牺牲内容表达。

二、产物
1. 把结果生成在同一个文件夹里，主文件必须命名为 report.html，使用 UTF-8 编码并以中文呈现。
2. 只有一个 report.html 时可直接交付；如果还有数据、样式、脚本、图片、字体、PDF 或其他资源，也放在同一文件夹或其子目录中，并使用相对路径引用。
3. 多文件产物上传时需要压缩为 zip，report.html 必须位于 zip 根目录，不能只把外层文件夹整体放进压缩包。

三、平台页面外壳
1. 页面背景使用 #f5f5f7。
2. 主要内容区宽度为 1280px，水平居中；最外层页面容器不要设置左右 padding，使内容外沿与平台顶部菜单的 1280px 内容线对齐。
3. 汇报内容由白色圆角大卡片承载。第一张大卡片距页面顶部 26px，相邻大卡片之间间距 26px，最后一张大卡片距页面底部 72px；每张大卡片的 padding 均为 50px。
4. 不要重复制作页面级大标题、页头、返回按钮、分享按钮或 Logo，平台会在汇报上方统一提供标题和导航。
5. 包内资源使用相对路径，例如 ./images/a.png，不要使用以 / 开头的站点根路径。

四、运行环境
1. 页面可以使用 HTML、CSS、JavaScript、Canvas、SVG、WebGL、相对路径资源、fetch("./data.json")、包内音视频、PDF、下载、由用户触发的外链或新标签页，以及 Blob Worker。
2. 页面运行在隔离沙箱中，不要依赖 Cookie、localStorage、IndexedDB、Service Worker、主站 API、顶层页面跳转、剪贴板读取、摄像头、麦克风、定位或其他设备权限。需要保存的页内交互状态放在页面内存或 DOM 中。
3. 页面只能加载同一汇报包内的资源，不能调用外部 API、CDN，不能加载外链图片、字体、音视频或 iframe。需要使用的依赖和媒体文件必须随汇报一起打包。
4. 用户点击的 HTTPS 链接可以通过 target="_blank" 在新标签页打开。HTTP 链接和真正的表单提交不可用；表单只用于页内交互时，需要用 JavaScript 阻止默认提交。

五、图表与媒体
1. 图表实现方式自由选择，可以使用 HTML/CSS、SVG、Canvas、WebGL、ECharts 或其他随汇报打包的前端库。
2. 照片、截图等位图建议转换为 WebP，质量建议设置为 90–95，并按页面实际展示尺寸缩放；不要直接使用远超展示尺寸的 4K/8K 原图，也不要把大图转换为 base64 塞进 HTML 或 data.js。
3. 视频优先使用浏览器兼容性最好的 MP4（H.264 视频编码 + AAC 音频编码）；如需额外提供 WebM，可作为补充格式而不是唯一格式。根据实际展示尺寸控制分辨率和码率，建议设置 poster，并使用 preload="metadata"，避免页面打开时预加载完整视频。
4. 图片、视频、PDF 等媒体文件保持为独立文件并使用相对路径引用，按需延迟加载，避免首次打开页面时同时加载全部大资源。

六、交付检查
1. 确认 report.html 可以打开，页面内容完整，包内资源路径正确，交互可用，关键数据与原始材料一致。
2. 单 HTML 文件可以直接上传；多文件汇报上传 zip，并确认 report.html 位于根目录。
3. 上传限制：压缩包或单 HTML 不超过 50MB，解压后全部文件总大小不超过 100MB，文件总数不超过 50 个，目录深度不超过 5 层；每个账号的全部项目合计存储上限为 2GB。`;

const ICON_BACK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[15px] w-[15px]">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

/** 小节标题：序号圆片 + 标题 */
function SectionTitle({ no, children }: { no: number; children: React.ReactNode }) {
  return (
    <h2 className="mb-5 flex items-center gap-2.5 text-[19px] font-semibold text-[#1d1d1f]">
      <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[rgba(0,113,227,0.1)] text-[14px] font-bold text-[#0071e3]">
        {no}
      </span>
      {children}
    </h2>
  );
}

/**
 * 提示行：统一灰色小图标 + 统一灰色文字，无底色无边框。
 * 注意：图标、正文一律灰色（#6e6e73）单一语言，重点词用深色加粗——
 * 不再出现彩色图标与黑色正文混排。
 */
function NoteRow({
  icon,
  children,
}: {
  icon: "info" | "upload" | "lock";
  children: React.ReactNode;
}) {
  const icons = {
    // 信息
    info: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-[13px] w-[13px] shrink-0 translate-y-[3px]">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8h.01M12 12v4" />
      </svg>
    ),
    // 上传
    upload: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[13px] w-[13px] shrink-0 translate-y-[3px]">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="m7 10 5-5 5 5M12 5v10" />
      </svg>
    ),
    // 锁
    lock: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[13px] w-[13px] shrink-0 translate-y-[3px]">
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
    ),
  } as const;
  return (
    <div className="mt-3 flex items-start gap-2.5 text-[13px] leading-[19px] text-[#6e6e73]">
      {icons[icon]}
      <span>{children}</span>
    </div>
  );
}

/**
 * Prompt 复制按钮：固定宽度（52px）居中，「复制 / 已复制」两态切换时
 * 按钮尺寸零变化（仅文字与配色切换）
 */
function CopyButton() {
  const [copied, setCopied] = useState(false);

  // 与 share-modal / guest-otp-modal 同一乐观翻转模式；额外加 800ms 竞速——
  // 文档失焦等场景下 writeText 的 Promise 可能永远 pending，竞速保证一定落到
  // execCommand 兜底并翻转「已复制」2 秒
  async function copy() {
    try {
      await Promise.race([
        navigator.clipboard.writeText(PROMPT),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 800)),
      ]);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = PROMPT;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex h-[28px] w-[52px] items-center justify-center rounded-full text-[12px] font-semibold text-white transition-colors duration-200 ${
        copied ? "bg-[#34c759]" : "bg-[#0071e3] hover:bg-[#0077ed]"
      }`}
    >
      {copied ? "已复制" : "复制"}
    </button>
  );
}

/** 流程节点 */
function FlowNode({ t, d }: { t: string; d: string }) {
  return (
    <div className="flex flex-col rounded-lg bg-[#f7f7f7] px-5 py-[18px] shadow-[0_1px_0_rgba(0,0,0,0.03),0_2px_6px_rgba(0,0,0,0.025)]">
      <div className="text-[14px] font-[650] text-[#1d1d1f]">{t}</div>
      <div className="mt-[5px] text-[12.5px] leading-[1.6] text-[#6e6e73]">{d}</div>
    </div>
  );
}

/** 使用节点：上传之后的 2x2 子卡 */
function UsageNode({ t, d }: { t: string; d: string }) {
  return (
    <div className="rounded-lg bg-[#f7f7f7] px-5 py-4 shadow-[0_1px_0_rgba(0,0,0,0.03),0_2px_6px_rgba(0,0,0,0.025)]">
      <div className="text-[14px] font-[650] text-[#1d1d1f]">{t}</div>
      <div className="mt-[5px] text-[12.5px] leading-[1.7] text-[#6e6e73]">{d}</div>
    </div>
  );
}

/** FAQ：点击问题展开/收起答案（原生 details/summary，零 JS，兼容无脚本）。
 *  不用卡片包裹，整节靠条目间距分隔，符合"不加分割线、用留白"的全站规则。
 *  左侧序号与问题同色，右对齐占两位数字宽（最多 2 位数），与问题文字
 *  仅隔 6px；箭头紧跟问题文字（间距 8px），展开时向下旋转 90°；
 *  summary 禁用 marker（自定义箭头），Safari/iOS 下需要明确 list-style: none。
 */
function FaqTile({ no, q, a }: { no: number; q: string; a: React.ReactNode }) {
  return (
    <details className="group block">
      <summary
        className="flex cursor-pointer list-none items-center gap-2.5 py-4 text-[14px] font-[600] leading-[1.5] text-[#1d1d1f] [&::-webkit-details-marker]:hidden"
        style={{ listStyle: "none" }}
      >
        <span className="w-[18px] shrink-0 text-right tabular-nums">
          {no}.
        </span>
        <span>{q}</span>
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="ml-1 h-[13px] w-[13px] shrink-0 text-[#86868b] transition-transform duration-200 ease-out group-open:rotate-90"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
      </summary>
      {/* 答案缩进 = 序号槽 18px + 间距 10px（gap-2.5），与问题文字精确对齐 */}
      <div className="pb-5 pl-[28px] text-[13px] leading-[1.75] text-[#6e6e73]">
        {a}
      </div>
    </details>
  );
}

export default function GuidePage() {
  return (
    <Suspense fallback={null}>
      <GuideContent />
    </Suspense>
  );
}

function GuideContent() {
  // 返回目标：优先用来源路径（?from=），仅接受站内单斜杠路径防开放重定向；默认回首页
  const from = useSearchParams().get("from");
  const backHref =
    from && from.startsWith("/") && !from.startsWith("//") ? from : "/home";

  return (
    <main className="min-h-svh bg-[#f5f5f7] text-[#1d1d1f] antialiased">
      <div className="account-shell">
        {/* 页头 + 右侧返回（与新建项目页同一视觉轴） */}
        <div className="mb-[42px] flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[32px] font-bold leading-[1.15] tracking-[-0.02em] text-[#1d1d1f]">
              汇报页制作指南
            </h1>
            <p className="mt-2 text-[15px] leading-[1.5] text-[#6e6e73]">
              用 AI 生成汇报页，上传即可展示和分享。
            </p>
          </div>
          <Link href={backHref} className="btn-light shrink-0">
            {ICON_BACK}
            返回
          </Link>
        </div>

        {/* 1 制作流程 */}
        <section className="mb-7 rounded-[22px] bg-white px-9 py-9 shadow-[0_1px_2px_rgba(0,0,0,0.02),0_10px_30px_rgba(0,0,0,0.05)] md:px-14">
          <SectionTitle no={1}>制作流程</SectionTitle>
          <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-[1fr_28px_1fr_28px_1fr] md:gap-0">
            <FlowNode t="① 发模板给 AI" d="复制下方模板发给任意 AI：聊天 AI 可在结尾接上你的素材；办公 AI 直接发即可" />
            <div className="hidden items-center justify-center text-[18px] text-[rgba(0,122,255,0.55)] select-none md:flex">→</div>
            <FlowNode t="② AI 生成汇报页" d="AI 产出一个汇报文件夹：report.html 主文件 + 可选的 data.js、图片等辅助文件；简单汇报页往往只有一个 HTML" />
            <div className="hidden items-center justify-center text-[18px] text-[rgba(0,122,255,0.55)] select-none md:flex">→</div>
            <FlowNode t="③ 上传" d="单个 HTML 文件直接上传；带辅助文件则压成 zip。在首页点「＋」新建项目，上传并填写信息" />
          </div>
        </section>

        {/* 第 2 部分：Prompt */}
        <section className="mb-7 rounded-[22px] bg-white px-9 py-9 shadow-[0_1px_2px_rgba(0,0,0,0.02),0_10px_30px_rgba(0,0,0,0.05)] md:px-14">
          <SectionTitle no={2}>Prompt</SectionTitle>
          {/* 两个用法卡间距与到下方模板的间距一致（均 24px） */}
          <div className="-mt-3 mb-6 grid grid-cols-1 gap-6 md:grid-cols-2">
            <UsageNode t="在聊天 AI 里用" d="复制模板，在结尾接上你的工作素材一起发送" />
            <UsageNode t="在办公 AI 里用" d="直接把模板发给它，它已经掌握你的工作文档，无需再贴材料" />
          </div>
          <div className="overflow-hidden rounded-lg bg-[#f7f7f7] shadow-[0_1px_0_rgba(0,0,0,0.03),0_2px_6px_rgba(0,0,0,0.025)]">
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-[12.5px] font-semibold text-[#6e6e73]">汇报页生成模板</span>
              <CopyButton />
            </div>
            <pre className="m-0 overflow-x-auto px-5 pb-[18px] font-mono text-[12.5px] leading-[1.75] whitespace-pre-wrap break-words text-[#1d1d1f]">
              {PROMPT}
            </pre>
          </div>
          <p className="mt-[22px] text-[13px] text-[#6e6e73]">
            模板只保留平台外壳、运行边界和交付要求；卡片内部的排版与视觉表达由 AI 根据内容自由设计。
          </p>
          <NoteRow icon="info">
            重要数据务必亲自核对：AI 只能基于它拿到的材料写内容，材料之外的数据会被编造。
          </NoteRow>
        </section>

        {/* 3 文件结构与上传 */}
        <section className="mb-7 rounded-[22px] bg-white px-9 py-9 shadow-[0_1px_2px_rgba(0,0,0,0.02),0_10px_30px_rgba(0,0,0,0.05)] md:px-14">
          <SectionTitle no={3}>文件结构与上传</SectionTitle>
          <p className="-mt-3 mb-6 text-[13px] leading-[1.7] text-[#6e6e73]">
            AI 生成的是一个文件夹，主文件是 report.html，可能还带 data.js、图片等辅助文件。上传支持两种方式，按产物选择即可：
            <br />
            <strong className="font-[650] text-[#1d1d1f]">只有一个 HTML 文件</strong>
            ——最常见的情况，不用打包，直接上传这个文件；
            <br />
            <strong className="font-[650] text-[#1d1d1f]">带辅助文件</strong>
            ——选中文件夹里的全部文件压缩成一个 zip
            （选中文件压缩，不要把文件夹本身压进去，保证 report.html 在压缩包根目录）。
          </p>
          <div className="overflow-x-auto rounded-lg bg-[#f7f7f7] px-5 py-4 shadow-[0_1px_0_rgba(0,0,0,0.03),0_2px_6px_rgba(0,0,0,0.025)]">
            <div className="min-w-[760px] font-mono text-[12.5px] leading-[2] whitespace-nowrap text-[#1d1d1f]">
              <div>汇报文件夹</div>
              {[
                ["├──", "report.html", "必须有，名字不能改；打 zip 时必须放在根目录，这是汇报页的入口"],
                ["├──", "data.js", "可选：数据文件，HTML 里用相对路径引用"],
                ["├──", "style.css", "可选：外链样式表，包内图片字体同样可用"],
                ["├──", "chart.js", "可选：其他脚本 / 图片 / 字体等辅助文件"],
                ["└──", "…", "可选：包内文件用相对路径随意引用，都会正常加载"],
              ].map(([branch, name, description]) => (
                <div
                  key={name}
                  className="grid grid-cols-[44px_130px_28px_minmax(0,1fr)] items-baseline"
                >
                  <span>{branch}</span>
                  <span className={name === "report.html" ? "font-semibold text-[#b91c1c]" : undefined}>
                    {name}
                  </span>
                  <span>←</span>
                  <span>{description}</span>
                </div>
              ))}
            </div>
          </div>
          <NoteRow icon="info">
            上限：上传文件 50MB（HTML 或 zip）、解压后 100MB、50 个文件、目录 5 层。
          </NoteRow>
          <NoteRow icon="lock">
            汇报只允许加载包内资源。脚本、图片、字体、媒体和其他依赖都要放进汇报文件夹，并使用相对路径引用。
          </NoteRow>
        </section>

        {/* 4 上传之后 */}
        <section className="mb-7 rounded-[22px] bg-white px-9 py-9 shadow-[0_1px_2px_rgba(0,0,0,0.02),0_10px_30px_rgba(0,0,0,0.05)] md:px-14">
          <SectionTitle no={4}>上传之后</SectionTitle>
          {/* grid-auto-rows:1fr 四卡等高，自动适配内容最多的那张 */}
          <div className="grid auto-rows-fr grid-cols-1 gap-4 md:grid-cols-2">
            <UsageNode
              t="查看"
              d="首页点击项目卡片即可进入汇报页，页面顶部提供标题、分享和返回入口，向下浏览正文时会随页面一起收起。"
            />
            <UsageNode
              t="分享"
              d="右上角「分享」可把汇报加入一个或多个分享面板，也可生成带 4 位提取码和有效期的分享链接；复制的链接已自带提取码，对方打开后自动验证、无需登录，所有授权集中在「分享管理」。"
            />
            <UsageNode
              t="编辑"
              d="卡片上的编辑入口可随时修改标题、日期、标签、关键词和简介，也可以更换报告文件——不更换则保留原文件。"
            />
            <UsageNode
              t="删除"
              d="卡片上的删除入口需要输入确认码才能执行，防止误触。删除后报告文件、面板入口和分享链接一并失效，不可恢复。"
            />
          </div>
        </section>

        {/* 5 常见问题 */}
        <section className="rounded-[22px] bg-white px-9 py-9 shadow-[0_1px_2px_rgba(0,0,0,0.02),0_10px_30px_rgba(0,0,0,0.05)] md:px-14">
          <SectionTitle no={5}>常见问题</SectionTitle>
          {/* overflow-anchor:none：把 FAQ 列表排除出浏览器滚动锚定候选。
              否则展开某条时，下方条目被选作锚点又被推下，浏览器为保持
              锚点不动会自动下滚，导致被点击的条目向上跳动 */}
          <div className="flex flex-col [overflow-anchor:none]">
            <FaqTile
              no={1}
              q="图表怎么画？"
              a="可以使用 HTML/CSS、SVG、Canvas、WebGL 或任意合适的图表库。使用第三方库时，需要把依赖文件放进汇报包并用相对路径引用，不能依赖外部 CDN。"
            />
            <FaqTile
              no={2}
              q="图片能放吗？"
              a="能。把图片放进汇报文件夹并使用相对路径引用；平台不加载外链图片。照片和截图优先转成 WebP，并缩放到接近实际展示尺寸。大图不要做成 data URI；首屏外图片使用懒加载，图片切换只预取前后相邻项。"
            />
            <FaqTile
              no={3}
              q="生成效果不满意？"
              a="直接在对话里继续提要求让 AI 改（「卡片间距大一点」「换一种图表」），改到满意再上传最终版；在项目编辑页可以随时更换文件。"
            />
            <FaqTile
              no={4}
              q="上传后页面空白？"
              a="zip 上传优先检查 report.html 是否在压缩包根目录、文件名是否正确；再检查辅助文件的相对路径引用是否有效。如果打 zip 时把整个文件夹包了一层（report.html 变成 文件名/report.html），就会出现空白。"
            />
            <FaqTile
              no={5}
              q="单文件上传 HTML 后，图片 / 数据文件全裂了？"
              a="单 HTML 上传只适合脚本、样式、图片全部内联在 HTML 里的独立页面。如果页面还引用了 data.js、images/ 等外部子文件，就必须选中所有文件打包成 zip 一起上传。"
            />
            <FaqTile
              no={6}
              q="新建项目时名称 / 关键词 / 简介被提示「xx 字内」，计数规则是什么？"
              a="按「汉字计 1、半角字母数字和英文标点数 0.5」，这样 20 字上限能放 20 个汉字或 40 个半角字符。标签按纯字数计数（汉字和字母都算 1）。输入超限不会被截断，但提交会被拦截，实时提示里会显示错误。"
            />
            <FaqTile
              no={7}
              q="上传提示「容量不足」？"
              a="单次压缩包上限 50MB、解压后 100MB、50 个文件；每个用户所有项目合计存储上限 2GB。超限后先在首页删除不再需要的旧报告即可释放空间。"
            />
            <FaqTile
              no={8}
              q="图片裂了，本地预览正常但上传后有几张加载不出来？"
              a="检查图片是否已经放进汇报包，并使用 ./images/a.png 这种相对路径；不要使用以 / 开头的路径或外链图片。还要确认文件名大小写完全一致，且 zip 没有多包一层外部文件夹。"
            />
          </div>
        </section>
      </div>
    </main>
  );
}
