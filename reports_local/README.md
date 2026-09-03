# HTML 汇报页面制作规范

本文件是 `reports_local/**` 内 HTML 汇报的唯一制作规范，适用于生成、修改、检查、预览和打包；仓库根 `AGENTS.md` 只规范 SURGE 平台源码和平台 UI，不作为汇报内部设计依据。制作汇报前必须完整阅读本文件，不得把平台页面偏好或上一份汇报的局部设计机械复制到新汇报。

页面由“大卡片”组成，每一张卡片承载一个信息单元（章节），卡片之间上下堆叠。固定规范约束平台兼容、安全边界、页面宽度、背景和整体间距；没有在本文明确写成固定规范的内部排版，由设计者按当前材料决定。

---

## 一、产物

- 每个汇报项目一个独立文件夹，位于对应日期目录下，命名为 `report-01`、`report-02`…（按日期目录内顺序编号）。
- 主文件命名为 `report.html`（UTF-8 编码、中文页面），这是唯一有命名要求的文件。
- **文件夹内分区（固定）**：
  - `source/` —— 原始素材（用户给的原始数据、分析产物、生成脚本等，仅存档用，不参与上传）。
  - 汇报目录根 —— 需要上传的内容：`report.html`、`data.js`、`assets/` 等被页面相对路径引用的文件，全部直接放在汇报目录（或其子目录）下。ECharts 等平台内置库**不放进汇报目录**（见第五节）。
  - `report.zip` —— 上传压缩包，固定命名 `report.zip` 放在汇报目录下；打包内容 = 需要上传的内容（report.html + data.js + assets 等），**不含任何 ECharts 库文件、不含 source/**；打包时必须排除 `.DS_Store` 等 macOS 隐藏文件。
- 数据量较大时，把纯数据拆到同文件夹的 `data.js`（用 `var DATA = {...}` 的形式），页面通过 `<script src="data.js" defer></script>` 引用（`defer` 不阻塞 HTML 解析，且在 DOMContentLoaded 前执行完毕，图表初始化时数据已就绪）。
- 样式、图片、字体等辅助文件放在同一文件夹，一律用相对路径引用。

## 二、页面约定（展示平台的固定要求）

1. 页面背景 `#f5f5f7`。
2. 内容由"大卡片"承载，大卡片为白色圆角卡片。
3. 不要写页面大标题、页头、返回按钮、公司 Logo——平台会在页面上方统一展示标题和导航。
4. 所有 JavaScript 用 IIFE 包裹，不要声明全局变量，不要操作页面标题。
5. 引用包内资源一律用相对路径（`./images/a.png`）；唯一例外是平台公共资源，直接用 `/platform/` 开头的版本化 URL（见第五节）。
6. 页面首次打开、弹层打开、卡片或步骤切换时，禁止用 `autofocus`、`autoFocus` 或 `.focus()` 默认聚焦按钮、输入框、链接等交互元素，避免浏览器显示并非用户主动选择的高亮边框。
7. 弹层打开后焦点不能留在被遮挡的底层页面。自维护 HTML 弹层应给非交互的弹层容器设置 `tabindex="-1"`，通过 `.focus({preventScroll:true})` 聚焦该容器，并用 `:focus{outline:none}` 隐藏容器自身的焦点外观；不得把关闭按钮作为默认焦点。
8. 真正的 Modal（弹窗）仍须保留键盘可访问性：限制焦点留在弹层内、支持 `Esc` 关闭，并在关闭后把焦点恢复到触发弹层的元素。用户按 `Tab` 主动导航时，按钮、链接、输入框等交互元素的 `:focus-visible` 不得被全局隐藏。
9. 仅允许由用户明确操作直接触发的焦点转移，例如验证码发送成功后进入验证码框、验证码逐格导航，或提交失败后定位首个错误字段；不得仅因组件完成挂载或数据加载完成而抢占焦点。
10. 会动态显示的错误、加载状态、图例说明和操作区必须预留稳定空间；同一组件状态切换时不得把相邻内容顶开。汇报内 Modal（弹窗）打开后外壳宽高保持固定，步骤、加载和错误只在内部预留区或滚动区变化。
11. 参考文献、下载菜单、tooltip 等浮层必须按可视区域自适应朝上或朝下打开，并限制在视口内；禁止使用只相对按钮固定向下展开、在页面底部被裁切的定位方式。
12. PDF、图片、3D 场景等可能等待的内容必须先显示与页面一致的白色加载容器和明确状态，加载完成后原位替换；禁止先白屏、再突然出现内容，或在加载阶段切换成灰黑背景。

## 三、运行环境（展示平台的固定要求）

1. 页面可以正常使用 HTML/CSS/JavaScript、Canvas、SVG、WebGL、相对路径资源、`fetch("./data.json")`、包内音视频、PDF、下载、用户触发的外链/新标签页和 Blob Worker。
2. 页面运行在隔离沙箱中；不要依赖 Cookie、localStorage、IndexedDB、Service Worker、主站 API、顶层页面跳转、剪贴板读取、摄像头、麦克风、定位或其他设备权限。交互状态保存在页面内存/DOM 中。
3. 页面只能加载同一汇报包内的资源，不能调用外部 API、CDN，不能加载外链图片、字体、音视频或 iframe。脚本、数据、图片、字体和媒体必须放进报告文件夹并使用相对路径引用。
4. 用户点击的 HTTPS 链接可以通过 `target="_blank"` 在新标签页打开。HTTP 外链和真正的表单提交不可用；表单只用于页内交互，用 JavaScript 阻止默认提交。

## 四、间距规范（固定）

1. 大卡片宽度固定为 **1280px**（这个宽度指的是展示内容的大卡片本身的宽度），水平居中。
   **最外层页面容器（`.page`/`.wrap` 等）不得加左右 padding**——卡片必须铺满整个 1280px，卡片左右边缘就是 1280 内容线，要与平台汇报页菜单栏的左右边缘像素级对齐；留白一律由卡片自身的内边距提供（见第 2 条 50px 页边距）。参考实现 `.page{width:1280px;margin:0 auto;padding:26px 0 72px}` 就是零水平内边距的口径。
2. 每一张大卡片四周必须保留 **页边距**，上下左右均设置为 **50px**。
3. 页边距范围内不允许放置任何内容——所有文字、图形、图表等内容都必须落在页边距以内的内容区。
4. 该间距为固定规范，未经明确要求不得改动。
5. **卡片外间距（页面级节奏，本规范明确认可的紧凑布局）**：
   - 首张卡片到页面顶部的距离固定为 **26px**（`.page` 的 `padding-top`）。
   - 相邻大卡片之间的间距固定为 **26px**（`.card` 的 `margin-bottom`）——与首卡顶部距离统一为同一数值，节奏一致。
   - 最后一张卡片到页面底部固定为 **72px**（`.page` 的 `padding-bottom`）收尾。
   - 卡片宽度 1280px 水平居中，左右留白由视口宽度自动平分。
   - 参考实现：`.page{width:1280px;margin:0 auto;padding:26px 0 72px}` + `.card{margin-bottom:26px}`。
6. 卡片内首行文字（如标题）若需精确贴合 50px 留白线，使用 CSS 原生的 **Leading Trim**：`text-box-trim` / `text-box-edge`（简写 `text-box`），把行高裁剪到字形边界，使文字顶/底与留白线像素级对齐。示例：

```css
h2{
  line-height:1.25;               /* 兜底行高 */
  text-box-trim:trim-both;        /* Chrome 117+ 长写兼容 */
  text-box-edge:text alphabetic;  /* 顶部裁到字形，底部保留基线 */
  text-box:trim-both text alphabetic; /* 简写（Chrome/Edge 133+、Safari 18.2+） */
}
```

- 顶部用 `text`（裁到字形顶部，避免按 `cap` 裁切导致中文汉字顶部缺笔画），底部用 `alphabetic`（保留拉丁字母 descender）。
- 该属性在 Firefox 不支持，会回退到 `line-height` 效果；其他现代浏览器原生支持。

7. **标题 + 副标题为默认结构**：每张卡片以标题开头，标题下默认带一行副标题。
   - 标题字号固定为 **23px**，加粗；副标题字号固定为 **13.5px**，弱化色（如 `var(--muted)`）。
   - 标题与副标题**均适用**上述 Leading Trim 规则，使其各自精确贴合留白线/彼此间距。
   - 标题与副标题之间的间距固定为 **16px**。
   - 副标题到下方正文的间距固定为 **26px**。

8. **正文排版固定规范**：
   - 正文字号固定为 **15.5px**，行高固定为 **1.78**（约 27.6px/行）。
   - 相邻正文段落之间的段间距固定为 **12px**。
   - 正文段落默认不带上边距，由前一个元素的 `margin-bottom` 提供间距。

9. **内嵌卡片间距（2 列布局）**：一个大卡片内横向只排 2 个卡片的布局（如总览机制卡 2×2、双栏要点、证据卡 2×2），卡片之间的间距（含横向列间距与上下行间距）统一为 **20px**。

10. **内嵌大卡片内部边距**：包含较多内容的内嵌卡片（机制速览卡 `.route`、要点面板 `.panel`、证据卡 `.ev` 的头部与主体），内部上下左右边距统一为 **20px**。
   - 此类卡片内的标题（`h3` / `h4`）适用第 6 条的 Leading Trim 规则，保持与卡片边缘精确贴合。
   - 带背景的**胶囊型标签**（如机制编号 `.route .no`）**不适用** Leading Trim，改用 `line-height` + `padding` 维持胶囊形态与垂直居中；若位于 flex 容器内，需设置 `align-self:flex-start` 防止被拉伸成整行背景条。
   - **无背景的文字型标签**（如肽名标签 `.route .pep`）若需与边距线（尤其卡片底部）精确对齐，适用第 6 条的 Leading Trim 规则。
   - 此类卡片内文字间距：**标题性标签 → 标题为 10px**；**标题 → 正文为 12px**（由标题元素 margin 提供）。
   - **2 列布局的内嵌卡片应贴底对齐**：卡片使用 flex 纵向布局（`display:flex;flex-direction:column`），末尾元素（如肽名标签 `.route .pep`）用 `margin-top:auto` 推到卡片底部，确保无论同行卡片高度如何，内容都精确贴住底部 20px 边距线。
   - 小卡片与标签类（如步骤链小卡 `.step`、徽章 `.badge`、状态胶囊 `.pill`）不适用，维持自身紧凑内边距。

## 五、图表（二选一）

- 简单图形：用内联 SVG 或 HTML + CSS 直接画在页面里。
- 数据图表（折线、柱状、饼图等）：用 ECharts。**平台已内置 ECharts**：生成或修改报告前，先读取 `reports/_shared/platform-manifest.json` 取得当前登记的 `fileName`（文件名内嵌内容 hash，升级时轮换），HTML 直接引用版本化平台 URL，**不把 ECharts 文件放进报告包**：

```html
<script defer src="/platform/<manifest 登记的 fileName>"></script>
<!-- 有数据文件时紧随其后（同样 defer）： -->
<script src="./data.js" defer></script>
```

（示例：当前 fileName 为 `echarts.42f8329d989b6f65.min.js`，以 manifest 为准，不写死。）

- `defer` 脚本不阻塞 HTML 解析，且在 DOMContentLoaded 前按文档顺序执行完毕，因此图表初始化放在 DOMContentLoaded 后执行即可，此时 ECharts 与 data.js 都已就绪；`window.echarts` 不存在（平台脚本加载失败）时给图表容器显示明确错误态。文档末尾写：

```html
<script>
(function(){
"use strict";
// 各图表 option 与 resize 注册（容器写明宽高，option 设 animation: false）
function initCharts(){ /* … */ }
// 平台 ECharts 加载失败时图表区域的错误态
function chartFallback(){
  var nodes = document.querySelectorAll('.ch, .hmp-chart');
  for (var i = 0; i < nodes.length; i++) {
    nodes[i].innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;min-height:120px;font-size:13px;color:#86868b">图表组件未能加载（echarts 不可用）。</div>';
  }
}
function start(){
  // defer 平台脚本先于 DOMContentLoaded 执行完毕：echarts 就绪即正常初始化；
  // 加载失败时 initCharts 内各图表段 guard 跳过，容器由 chartFallback 填入错误态
  try { initCharts(); } catch (e) { console.error('chart init failed', e); }
  if (!window.echarts) chartFallback();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
})();
</script>
```

- 禁止事项：`document.write` 注入脚本、本地 `echarts.min.js` 副本与任何 fallback loader、从 CDN 加载 ECharts、硬编码 `reports.glenhe.com` 域名。
- 参考实现：`2026-08-28/report-02/report.html`（含 3Dmol 懒加载）、`2026-08-17/report-01/report.html`（纯 ECharts）。
- **悬停/点击交互按图型统一（固定口径）**——同一类图表在全站的行为必须一致，按系列类型选择，不按页面各写各的：
  - **柱状图 / 条形图（含柱线混合图）**：`tooltip: { trigger:'axis', axisPointer: { type:'shadow' } }`。指针落在哪个类目，该类目出现浅色阴影带，tooltip 列出该类目下**全部系列**的数值。柱图禁用 `type:'line'` 指针（悬停柱子只出现一条孤立竖线，与柱形态不匹配）。
  - **折线图 / 时间序列**：`tooltip: { trigger:'axis', axisPointer: { type:'line' } }`（仅竖线，可加 `snap:true` 吸附数据点）。折线图禁用 `type:'cross'`（十字线 + 轴上数值标签，视觉过重）。
  - **热图 / 散点 / 饼图 / 雷达图（无共享类目轴）**：`tooltip: { trigger:'item' }`，提示框跟随单个数据项。
  - tooltip 本体样式全站一致：白底、1px 浅边框（`#e8e8ed`）、圆角、轻阴影，正文字号 11–12px。

- **图例（legend）统一**：带图例的图表（柱状图、折线图、柱线混合图等）图例一律放图表**右上角**：
  - 图标固定用**圆角正方形**：`icon:'roundRect'`，且 `itemWidth` 与 `itemHeight` 相同（如 10×10）。图例只承担颜色识别功能，**禁用长方形图标**（12×8 这类），折线图**禁用线形图标**（26×3、16×2 这类，也不要省略 icon 让它随系列类型渲染成线条）。
  - 图例右缘与**绘图区右缘**对齐：`legend.right` 取与该图 `grid.right` 相同的数值——即与最右侧可见的绘图元素（竖向网格线 / 绘图区边界）右对齐，**不与图表容器右边缘对齐**（禁止 `right:0` 贴边容器）。
  - 饼图、雷达图等无网格极坐标图不强制右上角位置，但图标同样用圆角正方形。
  - 用自定义 HTML 图例代替 ECharts 图例的页面（如 KTTKS MD 的膜接触比例图），同样遵守：右上角、9–10px 圆角正方形色块、右缘对齐绘图区右缘。

- **坐标轴与网格（固定口径）**：
  - `axisTick` 一律隐藏；`axisLine` 隐藏或极浅色（`#d2d2d7` 一类）；`splitLine` 用浅灰（`#eef0f3` / `#f0f0f4` 一类），禁深色网格线。
  - 轴名称写清物理量与单位，如「时间 (ns)」「距离 (nm)」；轴名/轴标签 10.5–13px、muted 色。
  - 类目轴标签多时用 `interval:0` + 旋转或抽样，不允许 ECharts 自动隔点跳标导致类目丢行。
  - `grid` 统一带 `containLabel:true`，避免轴标签被裁切。

- **柱形样式（固定口径）**：
  - 柱端圆角 3–6px：竖柱 `[4,4,0,0]`，横条 `[0,3,3,0]`；负值柱向下圆角。
  - `barMaxWidth` 20–28px，柱簇窄而不糊；禁满宽度柱。
  - 柱顶/柱侧数值标签 11px 浅灰（`#86868b`），数值 `tabular-nums`；标签过密时省略而不是缩小到 9px 以下。

- **热图色阶按语义分三档（固定口径）**：
  - **单调指标**（MD 接触率、RMSD、理化等"越大越好/越差"类）：单色蓝渐变，深蓝=好、浅蓝=差（如 `['#f3f6fc','#a9c3f2','#5b8def']`）。
  - **以 0 为中心的有利/不利指标**（如 ΔREU）：蓝-白-暖色发散色阶（蓝=有利），以对称阈值截断（如 ±2.5），中点纯白。
  - **离散状态矩阵**（如能力覆盖"支持/不支持"）：固定离散色序列，不用渐变。
  - `visualMap` 一律 `hoverLink:false`（悬停色阶联动会导致 grid 闪烁和内部错误）、`show:false`（图例含义在卡片正文里说明）。

- **参考线 markLine（固定口径）**：阈值/基线用 `type:'dashed'` 1px 灰（`#777`/`#aeb5bf`）、`silent:true` 不挡交互、标签 10px 灰且不遮挡数据；同一页面参考线风格一致。

- **图表工程惯例**：option 根部统一 `textStyle:{fontFamily:…}`（与页面字体一致）；页面所有实例收进数组，统一 `window.addEventListener('resize', () => charts.forEach(c => c.resize()))`。

## 六、图片与性能

1. 照片、界面截图等优先转为 WebP（建议质量 90–95），并按实际展示尺寸缩放；内容区只有 1280px 宽，不要直接塞入远超展示尺寸的 4K/8K 原图。
2. 首屏主图可设 `fetchpriority="high"`；首屏以外的图片使用 `loading="lazy"` `decoding="async"`，并写明 `width/height` 或 `aspect-ratio`，避免解码时反复重排。
3. 图片切换/轮播默认只加载当前图；首屏完成后只预加载前后相邻图片，切换前等待 `img.decode()`，不要一次性预加载所有大图。
4. 大图保持独立文件并用相对路径引用，不要把大图转为 base64/data URI 塞进 HTML 或 `data.js`。
5. 外部大 JS 不在 head 同步加载阻塞 HTML 解析：ECharts 按第五节的 `defer` 平台脚本引用，data.js 同样 `defer`，图表初始化在 DOMContentLoaded 后执行（此时两者已就绪）；禁止 `document.write` 注入脚本。
6. 3Dmol 等非首屏大型库按需加载：用 IntersectionObserver（`rootMargin` 400px 左右）在滚动临近可视区时动态加载，且只加载一次，未滚动到不发起请求；加载失败复用页面既有的 3D fallback UI。参考实现：`2026-08-28/report-02` 的 `load3Dmol` / `watch3D`。
7. 不为提速降低用户要求保留的图片清晰度；优先优化请求时机、文件拆分、稳定 URL、缓存复用、解码和邻近预取。大图首次展示前可等待 `img.decode()`，返回已看内容时复用已加载节点，不重复创建相同资源请求。
8. 视频优先使用兼容性最广的 MP4（H.264 视频 + AAC 音频），需要透明背景或更高压缩效率时可额外提供 WebM 作为 `<source>`，但必须保留 MP4 回退。写明 `width`、`height` 或 `aspect-ratio`，非首屏使用 `preload="metadata"`，不要默认 `preload="auto"` 下载整段视频。

## 七、制作流程与内容边界

1. 开始前先盘点用户提供的材料、明确机制、数据、图片、参考文献和必须出现的结论；材料不足时先询问，不得补造实验值、来源或因果关系。
2. 先建立信息结构，再选择卡片内部排版。上一份汇报只能作为技术兼容或视觉参考，不能成为所有汇报的固定模板；用户的项目偏好也不能自动升级为全局硬规则。
3. 修改既有汇报时保留其业务内容、交互路径和已确认视觉，修复问题不得顺手重写无关章节。替换资源后检查全部相对路径、下载、外链、弹层和 PDF 预览。
4. JavaScript 按“状态、渲染、事件、资源加载”分清职责，避免由多个事件处理器分别修改同一视觉状态。交互初始化可重复调用时必须幂等，事件监听器和 observer 不得重复注册。
5. 交付前至少完成：HTML 语法与资源路径检查、压缩包清单检查、平台环境预览、主流桌面浏览器交互检查。涉及 PDF、音视频、Canvas、SVG、WebGL 或复杂弹层时，必须实际操作一次，不能只看静态代码。

## 八、设计

- 整体风格现代、专业、克制，信息层级清晰。
- 样式写在页面内的 `<style>` 里，小型图标可用内联 SVG，位图放文件夹里相对引用。
- 配色、布局、信息组织方式由设计者决定，充分发挥，但不得违反本文件第四部分的间距规范。

**本节定位：只管"外壳"，不管"内容"。** 卡片内部怎么组织信息——用不用编号、标题分几级、列表还是段落、图文怎么混排——完全由设计者按内容决定，本节不做任何要求。下面约束的只是卡片的边框、尺寸、对齐、分割线和字体档位这些"看得见的骨架"。

### 内嵌小卡（信息卡 / 证据卡 / 机制卡等）

1. **默认参考模式（非强制）**：最简圆角矩形——1px 极浅边框（如 `#eceff3`）、圆角 16px、无背景色（透出大卡片白底）。也可以用浅色底（`#fafafc` 一类）或克制的色块/色点点缀；不要大面积彩色底、彩色分割线、粗描边。
2. **成组卡片尺寸一致（硬规则）**：
   - 左右两张并排：两卡宽度相等（等分网格）、高度相等；内容多少不同时，矮的拉伸适配高的，不允许一高一矮。
   - 2×2 四张同组：四张卡宽高完全一致。
   - 高度差由内部弹性吸收：卡片 `display:flex;flex-direction:column`，主体内容区 `flex:1`。
   - **网格多行必须统一行高**：`grid-auto-rows:1fr`——grid 默认只保证同一行内等高（align-stretch），跨行各行按内容自动定高，2 行就会一高一矮；加此属性后所有行取同一高度，四张卡才真正同尺寸。
3. **底部对齐（硬规则）**：卡片内需要强调的收尾内容（结论行、关键指标、标签等）用 `margin-top:auto` 推到卡片底部、贴住内边距线；同组卡片的此类元素底边齐平。
4. **分割线**：默认不用，内容分隔靠间距或背景色块；确有语义需要（表格、时间线）可用 1px 浅灰线，禁止彩色粗分割线。
5. 间距沿用第四节：内嵌卡内边距 20px、组内 gap 20px。

### 证据卡参考模式（编号锚点式）

多张并列的证据/结论卡可参考 P15 的写法（参考实现：`2026-08-28/report-02` 的 `.evgrid`/`.ev`）：

- **层级只编一层号**：每张卡左上角一个机制色大编号（`01–04`，约 30px/700，颜色 `color-mix(in srgb, var(--c) 80%, #fff)`）作识别锚点，标题近黑加粗排在编号右侧（基线对齐）；**条目层禁止再编号**——列表项用 6px 机制色小圆点（`li::before` 空内容圆点，颜色同系但更淡），不要"卡片 01 下又是条目 01/02/03"的双层编号，满屏数字。
- 每张卡经 `--c` 自定义属性传机制色（蓝/绿/紫/橙各一张），编号、圆点吃色，标题与正文黑白灰。
- 网格容器：`display:grid;grid-template-columns:1fr 1fr;gap:20px;grid-auto-rows:1fr`（末项保证四卡同尺寸，见上一节第 2 条）。
- 参考结构：

```css
.evgrid{display:grid;grid-template-columns:1fr 1fr;gap:20px;grid-auto-rows:1fr}
.ev{border:1px solid #eceff3;border-radius:16px;background:#fff;padding:20px}
.ev-head{display:flex;align-items:baseline;gap:12px}
.ev-no{font-size:30px;font-weight:700;line-height:1;color:color-mix(in srgb,var(--c) 80%,#fff)}
.ev-title{font-size:15.5px;font-weight:700;color:#1d1d1f;line-height:1.35}
.ev-ol{list-style:none;margin-top:14px}
.ev-ol li{position:relative;padding-left:17px;font-size:13.5px;line-height:1.7;margin-bottom:11px}
.ev-ol li:last-child{margin-bottom:0}
.ev-ol li::before{content:"";position:absolute;left:1px;top:9px;width:6px;height:6px;border-radius:50%;background:color-mix(in srgb,var(--c) 75%,#fff)}
```

```html
<div class="ev" style="--c:#0071e3">
  <div class="ev-head"><span class="ev-no">01</span><span class="ev-title">标题</span></div>
  <ol class="ev-ol"><li>条目…</li></ol>
</div>
```

其他编号列表形式（带圈数字、彩色小号数字编号条目）不要再用。

### 字体档位（建议口径）

只定档位区间，具体取值自选，但**同一页面内同类元素必须统一**：

| 元素 | 档位 |
|---|---|
| 内嵌卡片标题 | 13–15px · 650–700 · 近黑 |
| 卡片正文 / 条目 | 12–13.5px · 行高 1.6–1.8 · #1d1d1f 或 #3a3a3c |
| 说明 / 标签 / 角标 | 10.5–12px · var(--muted) |
| 数值 | tabular-nums，关键数值可加大/加粗 |
| 氨基酸序列 / 代码 / 坐标 | 等宽字体栈（`ui-monospace,"SF Mono",Menlo,Consolas,monospace`），序列加浅底胶囊可参考 |
| 识别锚点（编号、小圆点等） | 可用机制色，其余文字以黑白灰为主 |

留白宁松勿挤：条目间距 10–12px 起步，内容多的卡片靠拉伸补齐高度，不要为了紧凑压缩呼吸感。

### 视觉令牌（硬规则：全站命名与取值统一）

页面 `:root` 统一使用下列变量名与取值，页面内的颜色/字体引用一律走变量，不散写十六进制值：

| 令牌 | 值 | 用途 |
|---|---|---|
| `--ink` | `#1d1d1f` | 正文近黑 |
| `--muted` | `#6e6e73` | 次要文字 |
| `--line` | `#e8e8ed` | 极浅描边 / 分割线 |
| `--card` | `#ffffff` | 卡片底色 |
| `--bg` | `#f5f5f7` | 页面浅灰背景 |
| `--accent` 等 | 页面自定机制色 | 每页 1 个主机制色 + 少量点缀，不用平台蓝 |

正文 `font: 15.5px/1.78 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif` + `-webkit-font-smoothing:antialiased`；图表 fontFamily 与页面一致。

### 语义色克制（硬规则，不锁具体色值）

- 红色只表警示 / 异常 / 未通过；绿色只表通过 / 达标；琥珀只表待复核 / 降权。彩色不当装饰用。
- 其余文字、线条、面一律黑白灰；机制色只上识别锚点（编号、小圆点、图例色块）。

### 状态徽章 / 标签胶囊（参考模式）

浅底深字软色对（`background` 极浅、`color` 加深同色系），999px 圆角、10.5–11px 字、padding 2–4px 8–10px。参考对：通过 `#e9f6f3`/`#28655f`、待复核 `#fff3e4`/`#8a4b10`、中性 `#efeff2`/`#606065`、异常浅红底深红字。不做描边式徽章、不做大色块标签。

### 标准表格（参考模式）

`.table-wrap` 外包 1px 边框（`--line`）+ 12px 圆角防溢出；表头浅底（`#f9f9fb`）+ 600 字重 12px；行 hover `#f7f7fa`；末行去底边；数字列 `tabular-nums`；`table-layout:fixed` + `overflow-wrap` 防长序列撑破。表格是"分割线例外"场景，单元格间 1px 浅线是语义需要，允许。

## 九、内容

- 汇报内容以用户提供的材料为准；材料不够先向用户要，不要自行编造数据。

### 文案口径（写给汇报读者，不是写给 AI 对话）

页面文案必须是"面向汇报读者的陈述"，禁止出现 AI 向用户解释的口吻。写完通读全文检查，以下三类一律处理（删除或改写为事实陈述）：

1. **报告自身的元信息**：如「截止 XXXX-XX-XX · 只总结当前结果，不展开下一阶段安排」「需要在汇报中明确的限制」「"效果好"在本报告中的含义」——报告范围、写法约定不写给读者看。
2. **AI 式辩护 / 免责堆叠**：如「不等于已证明结合或功能有效」「不构成重复性或亲和力证据」「没有被改写成'正常完成'」「不是被判定为失败」「这仍只来自一条轨迹」——科学边界保留一次、用事实句写（如「实验亲和力有待验证」），不在每个结论后重复贴防御性尾巴。
3. **AI 式论证句式**：如「两条路线均已交付，回答的问题不同」「不是……而是……」「关键点是：」「更准确的说法是」「这说明不能……」——改为直接陈述事实或结论。

## 十、交付

- 上传压缩包固定命名 `report.zip` 放在汇报目录下（见第一节分区规则）；包内不要包含 ECharts 库文件（平台已内置）与 `source/` 素材；使用平台资源的报告**本地验收走项目本地服务**（`next start` 或既有本地预览流程），`/platform/` 资源天然可用，不以 file:// 直接双击打开作为验收方式（纯静态、不引用平台资源的报告不受此限制）。
- 打包命令（在汇报目录下执行，**务必排除 `.DS_Store` 与隐藏文件**）：

```bash
zip -X -q -r report.zip report.html data.js assets -x '.*' -x '__MACOSX*' -x '*.DS_Store'
```

  - 若该汇报没有 `data.js` 或 `assets/`（如仅 report.html + papers/），按实际文件替换列表。
  - 打包后 `unzip -l report.zip` 检查一遍，确认没有 `.DS_Store`、没有 ECharts 库文件。
- 平台上传上限：压缩包或单 HTML 不超过 50MB、解压后全部文件总大小不超过 100MB、文件总数不超过 50 个、目录深度不超过 5 层；单个用户的全部项目合计存储上限为 2GB，全站存储上限为 20GB。

## 十一、上传规则（必须严格遵守，违反会造成覆盖事故）

平台为 https://glenhe.com，API 基址 `https://glenhe.com/api/v1/reports`，认证 `Authorization: Bearer <sgk_令牌>`（令牌在 `.local/deploy.env`）。**上传前必须先读完本节再动手。**

### 11.1 新建 vs 更新（最关键的规则）

- **把报告当新项目上传时，一律用 `POST /api/v1/reports`**，响应返回新 slug（`{"ok":true,"slug":"r_xxxxxxxx"}`）。
- **`PATCH /api/v1/reports/{slug}` 只用于更新"同一个报告"的内容**。PATCH 会整体替换该 slug 的文件与元信息，**没有任何确认机制**。
- **上传前必须核对 slug 归属**：`.local/deploy.env` 里的 `GLENHE_REPORT_SLUG` 属于 report-01（MMP 报告），**绝不能**用它上传 report-02 或任何其他报告——patch 错 slug = 直接覆盖线上另一个项目（2026-08-28 事故：P15 的 zip 被 PATCH 到 MMP 的 slug 上，把 MMP 报告覆盖了）。
- 当前 slug 登记表（上传前对照）：
- 以后新增项目先 POST 拿到新 slug，并**把 slug 登记回本表**，同时更新该日期目录 `.local/deploy.env`（`GLENHE_REPORT_SLUG` 改成对应项目的 slug，谁部署谁改，不留共享的"当前 slug"歧义）。

### 11.2 元数据必须一次填全（六个字段）

**禁止只传 file + title + date。** tag、tagColor、description、keywords 必须与内容一起提交，否则线上项目卡片缺标签、缺简介、标签色退回默认红。字段与限制：

| 字段 | 必填 | 限制 | 说明 |
|---|---|---|---|
| `title` | 是 | ≤20 字（全角 1 / 半角 0.5 计权） | 项目卡片标题 |
| `date` | 是 | `YYYY-MM-DD` | 汇报日期 |
| `tag` | 否 | ≤6 字 | 项目卡片标签 |
| `tagColor` | 否 | 只能取色板 bg 值 | 未传回退默认红，必须主动选 |
| `description` | 否 | ≤200 字（同计权） | 项目卡片简介，按报告内容写一句实质概括 |
| `keywords` | 否 | ≤50 字（同计权） | 逗号分隔的核心词 |
| `file` | 是 | HTML 或 zip，≤50MB | zip 内主文件必须为 `report.html` |

`tagColor` 合法值（`src/features/reports/tag-colors.ts` 色板，传其他值会被静默替换为默认红）：

```text
红 #FEE2E2  橙 #FFEDD5  黄 #FEF3C7  绿 #DCFCE7  蓝 #DBEAFE  紫 #F3E8FF  灰 #F1F5F9
```

### 11.3 上传命令模板

新建（POST，返回新 slug）：

```bash
cd <日期目录>/.local && . ./deploy.env
curl -s -X POST "$GLENHE_API" -H "Authorization: Bearer $GLENHE_TOKEN" \
  -F "file=@<zip 路径>" \
  -F "title=…" -F "date=$(date +%Y-%m-%d)" \
  -F "tag=…" -F "tagColor=#DBEAFE" \
  -F "description=…" -F "keywords=…"
```

更新既有报告（PATCH，先核对 11.1 的 slug 归属）：

```bash
curl -s -X PATCH "$GLENHE_API/<slug>" -H "Authorization: Bearer $GLENHE_TOKEN" \
  -F "file=@<zip 路径>" -F "title=…" -F "date=…" \
  -F "tag=…" -F "tagColor=…" -F "description=…" -F "keywords=…"
```

### 11.4 上传后必须验证（两步，缺一不可）

1. **验证内容**：登录拿会话（`POST /api/auth/sign-in/email`，JSON `{"email","password"}`，`-c cookies.txt`）→ `GET https://glenhe.com/report/<slug>`（带 cookie）→ 从返回 HTML 里提取 `https://reports.glenhe.com/r/<capability>/report.html` → curl 拉取该 URL，确认 200 且内容是刚上传的报告（grep 关键标题/特征字符串）。
2. **验证元数据**：在验证页 HTML 里核对项目卡片渲染的标题/标签/颜色（或让用户在网页上确认）。

只有两步都通过才算上传完成；失败必须回滚或重传，不能放着不管。

### 11.5 上传后必须登记

每次上传——无论 `POST` 新建还是 `PATCH` 更新，无论成功还是失败——都要在仓库根目录的 [`upload.md`](./upload.md) 里追加一条记录。记录格式、元数据填写规范（标题 / 标签 / 颜色 / 简介 / 关键词）和参考示例都在那个文件里，**按规范填，不要临场发挥**。

### 11.6 用户偏好（上传相关）

- 每个报告是独立项目：简介、标签、标签颜色都要按该项目内容单独写，不许留空、不许套模板。
- 用户对"上传当成新项目"的理解 = 新建新 slug，不是往旧 slug 上 PATCH。
- 打包后的 zip 之外，本地保留一份 `report.html`；使用平台资源的报告本地预览走项目本地服务（见第十节），不在汇报目录放 ECharts 副本。
