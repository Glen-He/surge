"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

// 汇报页制作指南：从 Home 页头 / 新建项目页进入
// 视觉与 account-shell 体系一致（1080px 轨道、白卡 22px 圆角）；
// 主题色用苹果官网按钮蓝 #0071e3（全站主操作按钮/聚焦色统一同款）

const PROMPT = `请帮我把工作内容整理成一份数据汇报页面，要求如下：

一、产物
把结果生成在同一个文件夹里，主文件命名为 report.html（UTF-8 编码、中文页面）——这是唯一有命名要求的文件。
数据量较大时，可以把纯数据拆到同文件夹的 data.js（用 var DATA = {...} 的形式），页面通过 <script src="data.js"></script> 引用。
样式、图片、字体等辅助文件也放同一文件夹，一律用相对路径引用。

二、页面约定（展示平台的固定要求）
1. 页面背景 #f5f5f7，内容区固定宽度 1280px、水平居中，内容放在白色圆角卡片里；
2. 不要写页面大标题、页头、返回按钮、公司 Logo——平台会在页面上方统一展示标题和导航；
3. 所有 JavaScript 用 IIFE 包裹，不要声明全局变量，不要操作页面标题。

三、图表（二选一）
· 简单图形：用内联 SVG 或 HTML + CSS 直接画在页面里；
· 数据图表（折线、柱状、饼图等）：用平台内置的 ECharts——在 <head> 里写 <script src="../../lib/echarts.min.js"></script>（路径原样保留，平台自动解析），图表容器写明宽高，初始化代码用 IIFE 包裹并设置 animation: false。

四、设计
整体风格现代、专业、克制，信息层级清晰；样式写在页面内的 <style> 里，图片内联或放文件夹里相对引用。配色、布局、信息组织方式由你决定，充分发挥。

五、内容
汇报内容以你已掌握的我的工作材料为准；材料不够先向我要，不要自行编造数据。`;

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

/** 高亮提示块：普通圆角矩形 + 浅色底（蓝=说明 / 橙=注意），只用于关键信息 */
function Callout({ tone, children }: { tone: "blue" | "amber"; children: React.ReactNode }) {
  const styles = {
    blue: "bg-[rgba(0,122,255,0.07)] text-[#0066cc]",
    amber: "bg-[#fff9ef] text-[#5f470f]",
  }[tone];
  return (
    <div className={`mt-5 rounded-[10px] px-4 py-2.5 text-[13px] leading-[1.6] ${styles}`}>
      {children}
    </div>
  );
}

/**
 * Prompt 复制按钮：固定宽度（56px）居中，「复制 / 已复制」两态切换时
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
      className={`inline-flex h-[32px] w-[56px] items-center justify-center rounded-full text-[12px] font-semibold text-white transition-colors duration-200 ${
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
    <div className="flex flex-col rounded-xl border border-[#e8e8ed] bg-[#f9f9fb] px-5 py-[18px]">
      <div className="text-[14px] font-[650] text-[#1d1d1f]">{t}</div>
      <div className="mt-[5px] text-[12.5px] leading-[1.6] text-[#6e6e73]">{d}</div>
    </div>
  );
}

/** 上传之后 / 使用方式的功能块 */
function UsageNode({ t, d }: { t: string; d: string }) {
  return (
    <div className="rounded-xl border border-[#e8e8ed] bg-[#f9f9fb] px-5 py-4">
      <div className="text-[14px] font-[650] text-[#1d1d1f]">{t}</div>
      <div className="mt-[5px] text-[12.5px] leading-[1.7] text-[#6e6e73]">{d}</div>
    </div>
  );
}

/** 问答块：问题一行 + 答案独立段落，浅色底块分隔（不用分割线） */
function FaqTile({ q, a }: { q: string; a: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#e8e8ed] bg-[#f9f9fb] px-5 py-4">
      <p className="m-0 text-[14px] font-[650] text-[#1d1d1f]">{q}</p>
      <p className="m-0 mt-1.5 text-[13px] leading-[1.7] text-[#6e6e73]">{a}</p>
    </div>
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
        <section className="mb-7 rounded-[22px] border border-[rgba(0,0,0,0.055)] bg-[rgba(255,255,255,0.94)] px-9 py-9 shadow-[0_1px_2px_rgba(0,0,0,0.015),0_10px_30px_rgba(0,0,0,0.018)] md:px-14">
          <SectionTitle no={1}>制作流程</SectionTitle>
          <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-[1fr_28px_1fr_28px_1fr] md:gap-0">
            <FlowNode t="① 发模板给 AI" d="复制下方模板发给任意 AI：聊天 AI 可在结尾接上你的素材；办公 AI 直接发即可" />
            <div className="hidden items-center justify-center text-[18px] text-[rgba(0,122,255,0.55)] select-none md:flex">→</div>
            <FlowNode t="② AI 生成汇报页" d="AI 产出一个汇报文件夹：report.html 主文件 + 可选的 data.js、图片等辅助文件；简单汇报页往往只有一个 HTML" />
            <div className="hidden items-center justify-center text-[18px] text-[rgba(0,122,255,0.55)] select-none md:flex">→</div>
            <FlowNode t="③ 上传" d="单个 HTML 文件直接上传；带辅助文件则压成 zip。在首页点「＋」新建项目，上传并填写信息" />
          </div>
        </section>

        {/* 2 Prompt */}
        <section className="mb-7 rounded-[22px] border border-[rgba(0,0,0,0.055)] bg-[rgba(255,255,255,0.94)] px-9 py-9 shadow-[0_1px_2px_rgba(0,0,0,0.015),0_10px_30px_rgba(0,0,0,0.018)] md:px-14">
          <SectionTitle no={2}>Prompt</SectionTitle>
          {/* 两个用法卡间距与到下方模板的间距一致（均 24px） */}
          <div className="-mt-3 mb-6 grid grid-cols-1 gap-6 md:grid-cols-2">
            <UsageNode t="在聊天 AI 里用" d="复制模板，在结尾接上你的工作素材一起发送" />
            <UsageNode t="在办公 AI 里用" d="直接把模板发给它，它已经掌握你的工作文档，无需再贴材料" />
          </div>
          <div className="overflow-hidden rounded-xl border border-[#e8e8ed] bg-[#f9f9fb]">
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-[12.5px] font-semibold text-[#6e6e73]">汇报页生成模板</span>
              <CopyButton />
            </div>
            <pre className="m-0 overflow-x-auto px-5 pb-[18px] font-mono text-[12.5px] leading-[1.75] whitespace-pre-wrap break-words text-[#1d1d1f]">
              {PROMPT}
            </pre>
          </div>
          <p className="mt-[22px] text-[12px] text-[#6e6e73]">
            「页面约定」是平台的格式要求，建议保留原样；其余部分按你的需要随意增删修改。
          </p>
          <Callout tone="blue">
            <strong className="font-[650]">重要数据务必亲自核对：</strong>
            AI 只能基于它拿到的材料写内容，材料之外的数据会被编造。
          </Callout>
        </section>

        {/* 3 文件结构与上传 */}
        <section className="mb-7 rounded-[22px] border border-[rgba(0,0,0,0.055)] bg-[rgba(255,255,255,0.94)] px-9 py-9 shadow-[0_1px_2px_rgba(0,0,0,0.015),0_10px_30px_rgba(0,0,0,0.018)] md:px-14">
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
          <div className="rounded-xl border border-[#e8e8ed] bg-[#f9f9fb] px-5 py-4">
            <pre className="m-0 overflow-x-auto font-mono text-[12.5px] leading-[2] whitespace-pre text-[#1d1d1f]">
{`汇报文件夹
├── `}
<span className="font-semibold text-[#b91c1c]">report.html</span>
{`    ← 必须有，名字不能改；打 zip 时必须放在根目录，这是汇报页的入口
├── data.js        ← 可选：数据文件，HTML 里用相对路径引用
├── style.css      ← 可选：外链样式表，包内图片字体同样可用
├── chart.js       ← 可选：其他脚本 / 图片 / 字体等辅助文件
└── …              ← 可选：包内文件用相对路径随意引用，都会正常加载`}
            </pre>
          </div>
          <Callout tone="blue">
            上限：上传文件 5MB（HTML 或 zip）、解压后 10MB、50 个文件、目录 5 层。
          </Callout>
          <Callout tone="amber">
            <strong className="font-[650]">唯一的限制：不要引用文件夹外部或网络上的资源</strong>
            （CDN 脚本、外链图片等）——出于安全考虑不会加载，文件夹内的文件随便用。
          </Callout>
        </section>

        {/* 4 上传之后 */}
        <section className="mb-7 rounded-[22px] border border-[rgba(0,0,0,0.055)] bg-[rgba(255,255,255,0.94)] px-9 py-9 shadow-[0_1px_2px_rgba(0,0,0,0.015),0_10px_30px_rgba(0,0,0,0.018)] md:px-14">
          <SectionTitle no={4}>上传之后</SectionTitle>
          {/* grid-auto-rows:1fr 四卡等高，自动适配内容最多的那张 */}
          <div className="grid grid-auto-rows-[1fr] grid-cols-1 gap-4 md:grid-cols-2">
            <UsageNode
              t="查看"
              d="首页点击项目卡片即可进入汇报页，页面顶部有固定标题栏和返回按钮，向下滑动时也始终可见。"
            />
            <UsageNode
              t="分享"
              d="右上角「分享」生成链接，可设密码与有效期，对方免登录即可查看；最多 5 条、随时撤销，集中在首页「分享管理」。"
            />
            <UsageNode
              t="编辑"
              d="卡片上的编辑入口可随时修改标题、日期、标签、关键词和简介，也可以更换报告文件——不更换则保留原文件。"
            />
            <UsageNode
              t="删除"
              d="卡片上的删除入口需要输入确认码才能执行，防止误触。删除后报告文件和全部分享链接一并失效，不可恢复。"
            />
          </div>
        </section>

        {/* 5 常见问题 */}
        <section className="rounded-[22px] border border-[rgba(0,0,0,0.055)] bg-[rgba(255,255,255,0.94)] px-9 py-9 shadow-[0_1px_2px_rgba(0,0,0,0.015),0_10px_30px_rgba(0,0,0,0.018)] md:px-14">
          <SectionTitle no={5}>常见问题</SectionTitle>
          <div className="flex flex-col gap-3">
            <FaqTile
              q="图表怎么画？"
              a="简单图形让 AI 用内联 SVG 或 HTML + CSS 画；折线、柱状、饼图等数据图表直接用平台内置的 ECharts，模板里已写好用法，生成的图表更精致。"
            />
            <FaqTile
              q="图片能放吗？"
              a="能。文件夹里的图片文件（相对路径引用）和内联 SVG、data URI 都能正常显示；只有文件夹外部和网络上的图片不会加载。"
            />
            <FaqTile
              q="生成效果不满意？"
              a="直接在对话里继续提要求让 AI 改（「卡片间距大一点」「换一种图表」），改到满意再上传最终版；在项目编辑页可以随时更换文件。"
            />
            <FaqTile
              q="上传后页面空白？"
              a="zip 上传优先检查 report.html 是否在压缩包根目录、文件名是否正确；再检查辅助文件的相对路径引用是否有效。"
            />
          </div>
        </section>
      </div>
    </main>
  );
}
