export async function register() {
  // Next.js 会同时为 Node.js 与 Edge 编译 instrumentation。必须使用框架可静态
  // 识别的 NEXT_RUNTIME 分支，避免把数据库、文件系统和邮件模块打入 Edge 图。
  // eslint-disable-next-line no-restricted-properties -- Next.js 要求直接读取该框架变量，才能在构建期裁剪 Edge 分支。
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registerNodeRuntime } = await import("./instrumentation.node");
  await registerNodeRuntime();
}
