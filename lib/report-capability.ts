import {
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "crypto";

// ── 报告 capability（/r/<cap>/ 虚拟目录的访问凭证）──
//
// 权限分层：
//   session / share token → 负责「谁有资格打开报告」（父页面验证）
//   capability            → 负责「这个 iframe 可以读取哪些资源」（runtime 验证）
//   sandbox + CSP         → 负责「这些 JS 可以做什么」
//
// capability 绑定 reportId + revisionId + epoch + 过期时间，签名后编码为一个
// URL 安全 token。/r/<cap>/... 天然构成报告的虚拟根目录：浏览器按文档 URL
// 原生解析相对路径（./data.js、images/a.png、CSS url() 均无需改写），
// runtime 对每个请求验签并比对数据库当前 revision + epoch——报告文件被
// 替换（revision 轮换）或权限被吊销（epoch 递增，如撤销分享）后，旧
// capability 整体 404，且不泄露报告是否存在。
//
// payload 带版本前缀（v1），格式变更时升 v2 即可平滑淘汰旧 token。

const CAP_TTL_SEC = 6 * 60 * 60; // 6h：资源集中在初始加载，无需长 TTL
// 签发时间按小时取整：同一报告在同一时间窗内返回/重载时
// 获得稳定 URL，浏览器才能复用已验证的私有资源缓存。实际寿命
// 仍被限制在 5–6 小时，更换报告文件或撤销分享会轮换 URL 中的
// revision/epoch，不会命中旧资源。
const CAP_BUCKET_SEC = 60 * 60;
const VERSION = "v1";
const SCOPE = "read";

// 密钥隔离（key separation）：不与 Better Auth 会话签名共用同一密钥。
// REPORT_CAPABILITY_SECRET 显式指定优先；否则从 BETTER_AUTH_SECRET 经
// HKDF 派生独立子密钥（info 固定，同一主密钥可稳定派生）。
// 生产环境两者皆缺直接抛错——绝不静默落入固定值，否则 capability 可伪造。
let derivedKey: Buffer | null = null;

function capKey(): Buffer {
  const explicit = process.env.REPORT_CAPABILITY_SECRET;
  if (explicit) return Buffer.from(explicit, "utf-8");
  if (derivedKey) return derivedKey;
  const root = process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!root && process.env.NODE_ENV === "production") {
    throw new Error("缺少 BETTER_AUTH_SECRET：报告 capability 无签名密钥");
  }
  derivedKey = Buffer.from(
    hkdfSync(
      "sha256",
      root ?? "surge-dev-asset-secret",
      "surge-report-capability",
      "v1",
      32,
    ),
  );
  return derivedKey;
}

function capHmac(payload: string): string {
  return createHmac("sha256", capKey()).update(payload).digest("base64url");
}

/** 生成新的内容世代标识（报告每次替换文件时轮换） */
export function newRevisionId(): string {
  return randomBytes(12).toString("base64url");
}

/**
 * 签发报告只读 capability。
 * @param epoch 报告当前 capability 纪元（撤销分享等权限变化时递增）
 * @param maxExpiresSec 到期上限（unix 秒）——分享链路传分享自身的截止时间，
 *   防止「分享 18:00 到期、17:59 签出活到明天的 capability」
 * 返回值直接用作虚拟目录 URL 的第一段：/r/<cap>/report.html
 */
export function issueCapability(
  reportId: string,
  revisionId: string,
  epoch: number,
  maxExpiresSec?: number,
): string {
  const now = Math.floor(Date.now() / 1000);
  let expires = Math.floor(now / CAP_BUCKET_SEC) * CAP_BUCKET_SEC + CAP_TTL_SEC;
  if (maxExpiresSec !== undefined) {
    expires = Math.min(expires, maxExpiresSec);
  }
  const payload = `${VERSION}.${SCOPE}.${reportId}.${revisionId}.${epoch}.${expires}`;
  return `${Buffer.from(payload).toString("base64url")}.${capHmac(payload)}`;
}

/**
 * 报告子资源的强 ETag。revision 保证应用内更换文件时必然变化；
 * size/mtime 让平台内置资源在发布替换后也不会误返 304。哈希避免
 * 在响应头里暴露磁盘路径或 revision 原值。
 */
export function reportResourceEtag(
  revisionId: string,
  relativePath: string,
  size: number,
  mtimeMs: number,
): string {
  const digest = createHash("sha256")
    .update(revisionId)
    .update("\0")
    .update(relativePath)
    .update("\0")
    .update(String(size))
    .update("\0")
    .update(String(Math.trunc(mtimeMs)))
    .digest("base64url");
  return `"${digest}"`;
}

/** If-None-Match 可包含多个值或弱校验器；GET 重验证时均可命中。 */
export function requestMatchesEtag(
  ifNoneMatch: string | null,
  etag: string,
): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(",").some((candidate) => {
    const value = candidate.trim();
    return value === "*" || value === etag || value === `W/${etag}`;
  });
}

export type CapabilityGrant = {
  reportId: string;
  revisionId: string;
  epoch: number;
  expiresAt: number; // unix 秒
};

/** 验证 capability 签名与有效期（恒时比较）；无效返回 null */
export function verifyCapability(cap: string): CapabilityGrant | null {
  const dot = cap.indexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = cap.slice(0, dot);
  const sig = cap.slice(dot + 1);
  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf-8");
  } catch {
    return null;
  }
  const expect = Buffer.from(capHmac(payload));
  const got = Buffer.from(sig);
  if (expect.length !== got.length || !timingSafeEqual(expect, got)) return null;

  const parts = payload.split(".");
  if (parts.length !== 6 || parts[0] !== VERSION || parts[1] !== SCOPE) return null;
  const [, , reportId, revisionId, epochStr, expiresStr] = parts;
  const epoch = Number(epochStr);
  const expires = Number(expiresStr);
  if (
    !reportId ||
    !revisionId ||
    !Number.isSafeInteger(epoch) ||
    !Number.isFinite(expires)
  ) {
    return null;
  }
  if (expires < Math.floor(Date.now() / 1000)) return null;
  return { reportId, revisionId, epoch, expiresAt: expires };
}
