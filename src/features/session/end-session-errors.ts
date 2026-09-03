export class EndSessionError extends Error {
  constructor() {
    super("session termination failed");
    this.name = new.target.name;
  }
}

/** 将会话终止错误映射为 HTTP 响应。 */
export function endSessionErrorResponse(): Response {
  return Response.json({ error: "退出失败，请重试" }, { status: 503 });
}
