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
1. 页面背景 #f5f5f7，内容区固定宽度 1280px、水平居中，内容放在白色圆角卡片里；卡片宽度必须占满整个 1280px，最外层页面容器（.page/.wrap 等）不要加左右 padding——卡片左右边缘就是 1280 内容线，需要与平台菜单栏左右边缘对齐；卡片内部用自己的 padding 留白；
2. 不要写页面大标题、页头、返回按钮、公司 Logo——平台会在页面上方统一展示标题和导航；
3. 所有 JavaScript 用 IIFE 包裹，不要声明全局变量，不要操作页面标题；
4. 引用本地资源一律用相对路径（./images/a.png），不要用以 / 开头的路径。
5. 间距与排版（固定规范，不要改动）：
   · 每张大卡片四周边距（padding）上下左右均为 50px，所有内容都落在页边距以内的内容区；
   · 首张卡片距页面顶部 26px（页面容器 padding-top）、相邻卡片间距 26px（卡片 margin-bottom）、最后一张卡片距页面底部 72px（padding-bottom）；参考实现：.page{width:1280px;margin:0 auto;padding:26px 0 72px} + .card{padding:50px;margin-bottom:26px;border-radius:18px}；
   · 卡片标题 23px 加粗，标题下默认带一行 13.5px 弱化色副标题；标题→副标题间距 16px，副标题→正文 26px；
   · 正文 15.5px、行高 1.78；大卡片内 2 列内嵌卡片的间距（横向列间距与上下行间距）统一 20px，内嵌卡片内部上下左右边距 20px；
   · 标题/副标题要精确贴合留白线时，用 CSS Leading Trim：text-box-trim:trim-both; text-box-edge:text alphabetic; text-box:trim-both text alphabetic（兼容写法并存）。

三、运行环境与外部资源
1. 页面可以正常使用 HTML/CSS/JavaScript、Canvas、SVG、WebGL、相对路径资源、fetch("./data.json")、包内音视频、PDF、下载、用户触发的外链/新标签页和 Blob Worker。
2. 页面运行在隔离沙箱中；不要依赖 Cookie、localStorage、IndexedDB、Service Worker、主站 API、顶层页面跳转、剪贴板读取、摄像头、麦克风、定位或其他设备权限。交互状态保存在页面内存/DOM 中。
3. 外部 HTTPS API、CDN 脚本/样式、图片、字体、音视频和 iframe 可以直接在 HTML 中引用，不需要额外配置文件。fetch/XHR、ES Module 和字体等跨域资源仍需要对方服务器允许 CORS。
4. 出于稳定性、加载速度和私密考虑，能随报告打包的脚本、数据、图片、字体和媒体仍优先放进报告文件夹。HTTP 外链和真正的表单提交不可用；表单只用于页内交互，用 JavaScript 阻止默认提交。

四、图表（二选一）
· 简单图形：用内联 SVG 或 HTML + CSS 直接画在页面里；
· 数据图表（折线、柱状、饼图等）：用 ECharts。在 <head> 里按顺序写这两行，并把 echarts.min.js 放进同一文件夹：
  <script src="./_platform/echarts.min.js"></script>
  <script>window.echarts || document.write('<script src="echarts.min.js"><\\/script>')</script>
  图表容器写明宽高，初始化代码用 IIFE 包裹并设置 animation: false。
· 悬停/点击交互按图型统一：柱状/条形图（含柱线混合）用 tooltip trigger:'axis' + axisPointer type:'shadow'（类目阴影带，tooltip 列出该类目全部系列数值）；折线/时间序列用 trigger:'axis' + type:'line'（仅竖线）；热图/散点/饼/雷达用 trigger:'item'；一律不用 type:'cross'。
· 图例统一：放图表右上角，图标用圆角正方形（icon:'roundRect'，itemWidth 与 itemHeight 相同，如 10×10），只作颜色识别——禁长方形图标、折线图禁线形图标；legend.right 取与 grid.right 相同数值，与绘图区右缘对齐，不贴容器边缘（right:0 禁用）；饼/雷达等无网格图不强制位置但图标同为圆角正方形。
· 坐标轴：axisTick 隐藏，axisLine 隐藏或极浅（#d2d2d7），splitLine 浅灰（#eef0f3 一类）；轴名写清物理量与单位（如「时间 (ns)」）；grid 带 containLabel:true。
· 柱形：柱端圆角 3–6px（竖柱 [4,4,0,0]、横条 [0,3,3,0]）；barMaxWidth 20–28；柱顶数值标签 11px 浅灰 + tabular-nums。
· 热图色阶三档：单调指标用单色蓝渐变（深蓝=好）；以 0 为中心的有利/不利指标用蓝-白-暖发散（蓝=有利，对称截断）；离散状态矩阵用固定离散色。visualMap 一律 hoverLink:false、show:false。
· 参考线 markLine：dashed 1px 灰 + silent:true，标签 10px 灰不遮挡数据。
· 工程惯例：option 根部 textStyle.fontFamily 与页面字体一致；所有实例收进数组统一 resize 监听。

五、图片与性能
1. 照片、界面截图等优先转为 WebP（建议质量 90–95），并按实际展示尺寸缩放；内容区只有 1280px 宽，不要直接塞入远超展示尺寸的 4K/8K 原图。
2. 首屏主图可设 fetchpriority="high"；首屏以外的图片使用 loading="lazy" decoding="async"，并写明 width/height 或 aspect-ratio，避免解码时反复重排。
3. 图片切换/轮播默认只加载当前图；首屏完成后只预加载前后相邻图片，切换前等待 img.decode()，不要一次性预加载所有大图。
4. 大图保持独立文件并用相对路径引用，不要把大图转为 base64/data URI 塞进 HTML 或 data.js。

六、设计
整体风格现代、专业、克制，信息层级清晰；样式写在页面内的 <style> 里，小型图标可用内联 SVG，位图放文件夹里相对引用。卡片内部的信息组织、配色由你决定，充分发挥——只约束"外壳"：
· 内嵌小卡默认参考：1px 极浅边框（如 #eceff3）+ 圆角 16px + 无背景色（浅色底亦可，不要大面积彩色底/粗描边）。
· 成组卡片尺寸一致（硬规则）：左右两张并排必须等宽等高（矮卡拉伸适配高卡）；2×2 四张必须完全同尺寸；卡片用 flex column，主体 flex:1 吸收高度差。
· 强调收尾内容底部对齐（硬规则）：结论行/关键指标/标签用 margin-top:auto 推到卡片底部、贴住 20px 内边距线，同组底边齐平。
· 分割线默认不用（用间距分隔），语义需要（表格/时间线）可用 1px 浅灰，禁彩色粗分割线。
· 字体档位（同页同类元素统一）：卡片标题 13–15px / 650–700 近黑；正文条目 12–13.5px / 行高 1.6–1.8；说明标签 10.5–12px muted；数值 tabular-nums；序列/代码用等宽字体栈。留白宁松勿挤。
· 视觉令牌（硬规则）：:root 统一 --ink #1d1d1f / --muted #6e6e73 / --line #e8e8ed / --card #ffffff / --bg #f5f5f7 + 每页一个自定机制色 --accent；颜色引用走变量不散写；正文 15.5px/1.78 苹果字体栈。
· 语义色克制（硬规则）：红只表警示/异常，绿只表通过，琥珀只表待复核；彩色不当装饰，机制色只上识别锚点（编号、小圆点、图例色块），其余黑白灰。
· 状态徽章参考：浅底深字软色对 + 999px 圆角 + 10.5–11px 字（如通过 #e9f6f3/#28655f）；不做描边式徽章。
· 表格参考：.table-wrap 1px 边框 + 12px 圆角，表头 #f9f9fb 浅底 600 字重，行 hover #f7f7fa，末行去底边，数字列 tabular-nums，table-layout:fixed。
· 证据卡参考模式：每张卡左上角机制色大编号（01–04，30px/700，--c 传色）+ 近黑标题基线对齐；条目层禁止再编号（不要双层 01/01），列表项用 6px 机制色小圆点；2×2 网格加 grid-auto-rows:1fr 保证四卡同尺寸（grid 默认只同行等高，跨行会一高一矮）。

七、内容
汇报内容以你已掌握的我的工作材料为准；材料不够先向我要，不要自行编造数据。

八、交付
生成完成后提醒我：上传时压缩包里不要包含 echarts.min.js（平台已内置）；本地的 report.html 可以直接双击预览。
平台上传上限：压缩包或单 HTML 不超过 50MB、解压后全部文件总大小不超过 100MB、文件总数不超过 50 个、目录深度不超过 5 层；所有项目合计存储上限 2GB。`;

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

        {/* 2 Prompt */}
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
            「页面约定」是平台的格式要求，建议保留原样；其余部分按你的需要随意增删修改。
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
            （选中文件压缩，不要把文件夹本身压进去，保证 report.html 在压缩包根目录；
            echarts.min.js 不用压进去，平台已有内置版本）。
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
            报告可直接引用外部 HTTPS 资源；为了稳定、加载快和便于离线预览，仍建议优先把资源放进汇报文件夹。
          </NoteRow>
        </section>

        {/* 4 上传之后 */}
        <section className="mb-7 rounded-[22px] bg-white px-9 py-9 shadow-[0_1px_2px_rgba(0,0,0,0.02),0_10px_30px_rgba(0,0,0,0.05)] md:px-14">
          <SectionTitle no={4}>上传之后</SectionTitle>
          {/* grid-auto-rows:1fr 四卡等高，自动适配内容最多的那张 */}
          <div className="grid grid-auto-rows-[1fr] grid-cols-1 gap-4 md:grid-cols-2">
            <UsageNode
              t="查看"
              d="首页点击项目卡片即可进入汇报页，页面顶部提供标题、分享和返回入口，向下浏览正文时会随页面一起收起。"
            />
            <UsageNode
              t="分享"
              d="右上角「分享」可把汇报加入一个或多个分享面板，也可继续生成带独立密码和有效期的分享链接；对方均无需登录，所有授权集中在「分享管理」。"
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
              a="简单图形让 AI 用内联 SVG 或 HTML + CSS 画；折线、柱状、饼图等数据图表用 ECharts，模板里已写好两行 script 的引入方式。"
            />
            <FaqTile
              no={2}
              q="图片能放吗？"
              a="能。文件夹里的图片用相对路径引用；外部 HTTPS 图片也可直接引用。照片和截图优先转成 WebP，并缩放到接近实际展示尺寸。大图不要做成 data URI；首屏外图片使用懒加载，图片切换只预取前后相邻项。"
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
              a="检查路径写法：用 ./images/a.png 这种相对路径，不要以 / 开头（会被解析到内容域根目录而非你报告文件夹下）；外链图片必须使用 HTTPS，并检查对方是否防盗链或已失效。"
            />
          </div>
        </section>
      </div>
    </main>
  );
}
