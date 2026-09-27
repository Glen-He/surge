import {
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "crypto";
import { serverEnv } from "@/infrastructure/environment/server";

// ── 报告 capability（/report/<cap>/ 虚拟目录的访问凭证）──
//
// 权限分层：
//   session / share token → 负责「谁有资格打开报告」（父页面验证）
//   capability            → 负责「这个 iframe 可以读取哪些资源」（runtime 验证）
//   sandbox + CSP         → 负责「这些 JS 可以做什么」
//
// capability 绑定报告内容版本、授权来源及其版本、过期时间，签名后编码为一个
// URL 安全 token。/report/<cap>/... 天然构成报告的虚拟根目录：浏览器按文档 URL
// 原生解析相对路径（./data.js、images/a.png、CSS url() 均无需改写），
// runtime 对每个请求验签并检查当前报告版本与授权来源：内容替换时全局失效，
// 撤销分享仅使这个来源失效，面板成员移除也不影响其他入口。
// 失效统一返回 404，不泄露报告是否存在。
//
// v2 必须携带授权来源；旧格式直接失效，不保留兼容分支。

const CAP_TTL_SEC = 6 * 60 * 60; // 6h：资源集中在初始加载，无需长 TTL
// 签发时间按小时取整：同一报告在同一时间窗内返回/重载时
// 获得稳定 URL，浏览器才能复用已验证的私有资源缓存。实际寿命
// 仍被限制在 5–6 小时，更换报告文件或撤销分享会改变内容或来源版本，不会命中旧资源。
const CAP_BUCKET_SEC = 60 * 60;
const VERSION = "v2";
const SCOPE = "read";

// 密钥隔离（key separation）：不与 Better Auth 会话签名共用同一密钥。
// 从 BETTER_AUTH_SECRET 经 HKDF 派生独立子密钥（info 固定，同一主密钥
// 可稳定派生）。缺少根密钥直接抛错，绝不落入固定开发密钥。
let derivedKey: Buffer | null = null;

function capKey(): Buffer {
  if (derivedKey) return derivedKey;
  // 该配置始终必需：缺失或过短由 serverEnv 校验抛错，绝不落入固定开发密钥。
  derivedKey = Buffer.from(
    hkdfSync(
      "sha256",
      serverEnv.BETTER_AUTH_SECRET,
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

/**
 * 为可信父页与平台注入脚本派生一次 bridge token。
 * token 不进入上传 HTML 的可见数据，只用于认证 iframe 发出的平台操作消息。
 */
export function reportBridgeToken(capability: string): string {
  return createHmac("sha256", capKey())
    .update(`report-bridge:${capability}`)
    .digest("base64url");
}

/** 生成新的内容世代标识（报告每次替换文件时轮换） */
export function newRevisionId(): string {
  return randomBytes(12).toString("base64url");
}

/**
 * 签发报告只读 capability。
 * @param epoch 报告全局纪元（展示模式等全局变化时递增）
 * @param source 必须显式指定授权来源，分享入口不能省略后退回属主权限
 * @param maxExpiresSec 到期上限（unix 秒）——分享链路传分享自身的截止时间，
 *   防止「分享 18:00 到期、17:59 签出活到明天的 capability」
 * 返回值直接用作虚拟目录 URL 的第一段：/report/<cap>/report.html
 */
export function issueCapability(
  reportId: string,
  revisionId: string,
  epoch: number,
  source: CapabilitySource,
  maxExpiresSec?: number,
): string {
  const now = Math.floor(Date.now() / 1000);
  let expires = Math.floor(now / CAP_BUCKET_SEC) * CAP_BUCKET_SEC + CAP_TTL_SEC;
  if (maxExpiresSec !== undefined) {
    expires = Math.min(expires, maxExpiresSec);
  }
  const sourceId = source.kind === "owner" ? "-" : source.id;
  const sourceEpoch = source.kind === "owner" ? 0 : source.epoch;
  const payload = `${VERSION}.${SCOPE}.${reportId}.${revisionId}.${epoch}.${expires}.${source.kind}.${sourceId}.${sourceEpoch}`;
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

/** 授权来源与报告内容版本分离；面板使用成员世代而非对外短码。 */
export type CapabilitySource =
  | { kind: "owner" }
  | { kind: "share" | "board"; id: string; epoch: number };

export type CapabilityGrant = {
  source: CapabilitySource;
  reportId: string;
  revisionId: string;
  epoch: number;
  expiresAt: number; // unix 秒
};

/** 验证 capability 签名与有效期（恒时比较）；无效返回 null */
export function verifyCapability(cap: string): CapabilityGrant | null {
  if (
    cap.length > 512 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cap)
  ) {
    return null;
  }
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
  if (payload.length > 256) return null;
  const expect = Buffer.from(capHmac(payload));
  const got = Buffer.from(sig);
  if (expect.length !== got.length || !timingSafeEqual(expect, got)) return null;

  const parts = payload.split(".");
  if (parts.length !== 9 || parts[0] !== VERSION || parts[1] !== SCOPE) return null;
  const [, , reportId, revisionId, epochStr, expiresStr, kind, id, sourceEpochStr] = parts;
  const sourceEpoch = Number(sourceEpochStr);
  if (!Number.isSafeInteger(sourceEpoch) || sourceEpoch < 0) return null;
  if (kind !== "owner" && kind !== "share" && kind !== "board") return null;
  if (kind === "owner" ? id !== "-" || sourceEpoch !== 0 : !/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  const epoch = Number(epochStr);
  const expires = Number(expiresStr);
  if (
    !reportId ||
    !revisionId ||
    !Number.isSafeInteger(epoch) ||
    epoch < 0 ||
    !Number.isSafeInteger(expires)
  ) {
    return null;
  }
  if (expires <= Math.floor(Date.now() / 1000)) return null;
  return { reportId, revisionId, epoch, expiresAt: expires,
    source: kind === "owner" ? { kind } : { kind, id, epoch: sourceEpoch },
  };
}
