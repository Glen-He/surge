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

6. **禁止打开时默认高亮交互元素**：页面首次加载、Modal（弹窗）打开、卡片/步骤切换时，禁止用 `autoFocus` 或 `.focus()` 默认聚焦按钮、输入框、链接等交互元素。Modal 必须把初始焦点放在无可见 outline 的非交互容器上，保留 focus trap、Esc 关闭和关闭后焦点恢复。该规则同样适用于 `reports_local/` 中项目方维护的 HTML 弹层：打开时可聚焦带 `tabindex="-1"` 且隐藏自身 outline 的弹层容器，但不得聚焦关闭按钮或其他操作项。仅允许在用户明确操作后转移焦点，例如验证码发送成功后进入验证码框、验证码逐格导航、提交失败后定位首个错误字段；这些焦点变化必须是用户操作的直接结果。

# 注释与输出信息规范（用户强偏好，违反会被打回）

四类信息各归其层：**注释**给维护者（中文）、**日志与内部异常**给开发排查（英文）、**用户文案**给终端用户（中文、集中管理）。禁止混写。

## 1. 源码注释：中文

1. 说明性文字用中文；变量、类型、属性、函数/方法、CSS 选择器、组件/库、协议字段等可检索技术标识保留原拼写，按上下文可写成 `Modal（弹窗）`、`step`、`semibold`、`Prompt`，不得机械翻译。
2. 中文与英文、数字之间加一个空格：例 `最多创建 20 个分享面板`、`使用 pg_advisory_lock 串行化`。
3. 同一文件注释语言统一；不写复述代码的无意义注释；导出 API 用 JSDoc 中文说明。
4. 例外：自动生成文件、依赖/压缩/构建产物、直接下载的第三方文件（如 `reports/**/echarts.min.js`）保持原样；确需修改第三方文件时，只给自己新增/修改的片段写中文注释。

## 2. 运行日志（lib/logger.ts）：message 英文

1. message 是面向开发排查的英文短语，小写开头、说清事件（例 `"failed to rotate report storage pointer"`）。
2. 业务参数一律放 ctx 对象（`{ userId, slug }`），禁止拼进 message 字符串；scope 用英文 kebab-case。
3. 禁止在 message 里出现用户可见的中文文案。

## 3. 内部异常 message：英文

1. `throw new Error(...)` 与自定义异常类的 message 一律英文（配置校验、迁移完整性、内部断言等排查信息）。内部常量可写进 message；用户输入、路径、token、账号等业务参数必须放在异常的强类型字段或日志 ctx 中，避免后续记录 `error.message` 时意外泄漏。
2. 失败原因需要展示给用户时，异常只携带错误码 + 强类型 params，由 API 边界翻译。模式见 lib/upload-errors.ts 的 `UploadError` 与 lib/share-board-errors.ts 的 `ShareBoardError`；message 只写稳定英文错误码（如 `upload rejected: ZIP_FILE_COUNT`），不得拼接 params 或中文文案。

## 4. 用户可见文案：中文，仅允许三类位置

1. **文案模块**（领域文案唯一来源）：lib/auth-errors.ts（better-auth 错误码）、lib/upload-errors.ts（上传/解压/表单/配额）、lib/share-board-errors.ts（分享面板）、lib/password-policy.ts（密码策略）。新增可复用领域文案先进文案模块，不散落在业务代码里。
2. **API 边界层**：路由内一次性的请求级校验文案；better-auth 适配层（lib/auth.ts hooks）抛出的 APIError message（它本身就是响应体机制）。跨越业务层与 API 层的失败必须传递 code + 强类型 params，Route Handler 最后调用对应的 response 函数生成中文与 HTTP 状态，业务层不得提前生成中文字符串。
3. **纯校验或 UI 适配函数的返回值**：仅在结果不会继续跨层流转时可直接返回文案，如 `passwordPolicyError`、`verifyStoredOtp`。上传等跨层流程的校验函数必须返回结构化失败对象，不得返回裸字符串。

错误码与 params 必须通过映射类型绑定：需要参数的 code 漏传、错传或拼错字段应在 `tsc` 阶段失败；无参数 code 不得接收多余 params。HTTP 状态属于 API 适配语义，不放入领域异常对象。

用户文案绝不写入异常 message 或日志 message；前端 JSX 界面文案按产品语言（中文）书写。

## 5. 编码与来源边界

1. 文件编码统一 UTF-8（无 BOM）。
2. 已部署或运行时生成的内容默认不改，除非明确指定对应片段由项目方维护（含项目方本地维护的汇报模板与 HTML）。
3. 整理注释与文案不得改变代码行为。

## CR 自查清单

* [ ] 注释中文，技术标识保留英文，中英文之间有空格，无中英混杂

* [ ] logger message 英文，业务参数在 ctx 对象

* [ ] throw/自定义异常 message 只含稳定英文信息，不含用户输入或中文；需用户可见的走错误码 + 强类型 params + 边界翻译

* [ ] 跨层业务失败不传裸字符串；仅 Route Handler 生成中文响应与 HTTP 状态

* [ ] 错误码与 params 编译期绑定；异常对象不携带 HTTP status

* [ ] 新增领域文案进了对应文案模块，而非散落业务代码

* [ ] 文件编码 UTF-8
