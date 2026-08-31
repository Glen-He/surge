<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 项目 UI 硬性规则（用户强偏好，违反会被打回）

1. **禁止分割线**：用户非常反感分割线。弹窗、卡片、列表等任何新改动的 UI 一律不加水平/垂直分割线（border-bottom/top/left/right 作为 divider 使用时禁止）；内容分隔用间距（margin/padding）或背景色块实现。既有样式中仅 modal 头部默认分割线属于历史遗留，新弹窗必须传 `plainHeader`。

2. **浅色带边框按钮与深色按钮并排时尺寸必须对齐**：浅色按钮（白底 + 1px 边框，如 `.btn-secondary`）与深色实心按钮（如 `.btn-primary` / `.btn-danger` / 红色删除按钮）左右并排时，浅色按钮的高度与水平 padding 必须各补偿边框厚度（各 +1px × 2），保证**去掉边框后的内容尺寸与深色按钮完全一致**。例：深色按钮 `h-[38px] px-5`（20px），浅色按钮应为 `h-[40px] px-[21px]`。

   **实现坑**：`.btn-secondary` 等按钮类定义在 globals.css 的非 `@layer` 普通规则里，优先级高于 Tailwind v4 的 `@layer utilities`，因此 `h-[40px]` / `px-[21px]` / `text-[14px]` 等工具类**会被静默覆盖**。要微调这类按钮的尺寸/字号，必须用内联 `style={{ height, padding, fontSize }}` 强制覆盖。

3. **复用既有文案样式，不额外加容器框**：给一段普通文字补充功能（如复制按钮）时，保持原句式原样式，功能按钮以小图标（约 16px）**行内直接跟在目标文字后面**（间距约等于一个空格宽度，用 `ml-1`），**与前后文字的间距保持对称**（都用自然空格，不要一侧大一侧小）；不要用绝对定位飘到文字右上角，也不要为"展示文字 + 按钮"新造浅灰圆角矩形块。

4. **错误/提示信息位置必须常驻预留，禁止任何布局跳动**：输入框、上传区等可能出错的字段，其错误文案的位置（高度）必须在初始渲染时就预留出来（常驻空槽，如 `min-height` 固定的 `<p className="project-error">`），报错出现/消失时**周边元素和卡片尺寸零位移**。禁止用条件渲染 `{err && <p>…</p>}` 事后插入把下方内容顶开。为保证左右卡片字段对齐，选填字段下方也要放同高空槽占位。同理，卡片高度兜底 `min-height` + grid 等高规则保证同类卡片高度始终一致，不允许内容变化导致单卡变高。

5. **汇报页面顶部菜单必须随汇报内容滚动离场，禁止常驻屏幕**：汇报查看页的系统标题、分享/返回等顶部菜单必须与汇报正文保持同一滚动节奏，向下浏览内容时一起滚出可视区域；禁止使用会让菜单始终停留在屏幕上的 fixed/sticky 布局或独立滚动方案。汇报仍须保留真实 iframe 视口，不能通过把 iframe 拉成整篇正文高度来伪造页面滚动，以免再次破坏汇报内部的 `position: fixed`、`sticky`、`vh` 和弹层定位。

6. **注释语言与来源边界**：项目自维护的源码、配置、测试，以及项目方本地维护的汇报模板和 HTML 中，注释的说明性文字使用中文；涉及变量、类型、属性、函数/方法、CSS 选择器、组件/库、协议字段等可检索技术标识时必须保留原拼写，按上下文可写成 `Modal（弹窗）`、`step`、`semibold`、`Prompt` 等，不得机械翻译。已部署或运行时生成的内容默认不改，除非明确指定对应片段由项目方维护。自动生成文件、依赖/压缩/构建产物、直接下载的第三方文件及未修改部分的注释保持原样；如果确实修改了第三方文件，只处理项目方自己新增或修改的片段。整理或新增注释不得改变代码行为。
