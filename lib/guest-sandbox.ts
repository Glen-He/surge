import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "node:path";
import { db } from "./db";
import { ensureOtpMigration } from "./schema";
import { newRevisionId } from "./report-capability";
import {
  REPORT_DEMO_TEMPLATES_DIR,
  dirSizeBytes,
  userReportsDir,
} from "./report-storage";
import { deleteUserPermanently } from "./account-deletion";
import { logger } from "./logger";

export const GUEST_EMAIL_DOMAIN = "demo.surge";
export const GUEST_TTL_MINUTES = 60;

const DEMO_TEMPLATES_DIR = REPORT_DEMO_TEMPLATES_DIR;

export interface DemoTemplate {
  tplDir: string; // tpl-01..05 under reports/demo-templates
  title: string;
  date: string; // YYYY-MM-DD
  tag: string;
  tagColor: string; // lib/tag-colors.ts 7 色板之一
  description: string;
  keywords: string;
}

// 全部为同一个互联网技术人视角：陈默 · 高级后端工程师 · 平台架构组
// 日期：2026-08-14 (周五) 3 张，2026-08-07 (周五) 2 张
export const DEMO_TEMPLATES: DemoTemplate[] = [
  {
    tplDir: "tpl-01",
    title: "后台服务性能优化与迁移进度",
    date: "2026-08-14",
    tag: "性能优化",
    tagColor: "#DBEAFE",
    description: "订单服务批量写入模型引入 + 搜索服务从 ES 迁移到 OpenSearch，P99 接口响应下降 56%。",
    keywords: "Go,OpenSearch,Redis,性能优化",
  },
  {
    tplDir: "tpl-02",
    title: "V2.4.0 版本发布前迭代复盘",
    date: "2026-08-14",
    tag: "项目管理",
    tagColor: "#F3E8FF",
    description: "Sprint-37 燃尽分析、需求交付清单、发布前 Checklist；整体进度 88%，预计 8/18 晚间冻结。",
    keywords: "Sprint,燃尽图,发布冻结",
  },
  {
    tplDir: "tpl-03",
    title: "8.13 搜索服务超时故障 P1 分析报告",
    date: "2026-08-14",
    tag: "事故复盘",
    tagColor: "#FEE2E2",
    description: "Full GC 26 分钟影响 4.18 万用户，根因定位分词插件堆内存泄漏，附 5 条行动项。",
    keywords: "P1,GC,Postmortem,回滚",
  },
  {
    tplDir: "tpl-04",
    title: "V2.3.0 上线首周稳定性报告",
    date: "2026-08-07",
    tag: "稳定性",
    tagColor: "#DCFCE7",
    description: "核心接口可用率 99.982%，P0/P1 事故 0 起；3 个 P2 缺陷跟踪；SLA 达标。",
    keywords: "SLA,监控,MTTR",
  },
  {
    tplDir: "tpl-05",
    title: "AI 摘要功能技术可行性分析报告",
    date: "2026-08-07",
    tag: "技术预研",
    tagColor: "#FFEDD5",
    description: "PoC 6 项指标全部达标，成本 ¥0.032/条，建议立项排期至 V2.5，附脱敏 + RAG 架构。",
    keywords: "LLM,RAG,Feasibility",
  },
];

export function isGuestEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const lower = String(email).toLowerCase();
  return lower.endsWith("@" + GUEST_EMAIL_DOMAIN);
}

/**
 * 事件驱动：发送验证码接口的响应体里附带访客验证码（仅当收件人是访客邮箱）。
 * 前端拿到响应后直接弹 Toast —— 验证码显示的唯一触发路径就是"用户点击发送且发送成功"，
 * 不存在任何轮询 / 后台拉取，从根上杜绝"进页面就误弹"。
 */
export function guestOtpResponse(email: string, code: string, ttlSec = 600) {
  if (!isGuestEmail(email)) return {};
  return {
    guestOtp: { code: String(code).padStart(6, "0"), expiresIn: ttlSec },
  };
}

export async function seedDemoReports(userId: string): Promise<void> {
  await ensureOtpMigration();
  const userDir = userReportsDir(userId);
  await fs.mkdir(userDir, { recursive: true });

  // 按照 sort_order 顺序灌入（日期倒序 + 同一日期按 DEMO_TEMPLATES 顺序），与其他真实用户一致。
  const ordered = [...DEMO_TEMPLATES].map((t, idx) => ({ t, idx }));
  ordered.sort((a, b) => {
    if (a.t.date !== b.t.date) return a.t.date < b.t.date ? 1 : -1;
    return a.idx - b.idx;
  });

  let sortOrder = 0;
  for (const { t } of ordered) {
    const slug = `demo_${randomUUID().slice(0, 8)}`;
    const dest = path.join(userDir, slug);
    const src = path.join(DEMO_TEMPLATES_DIR, t.tplDir);
    try {
      await fs.cp(src, dest, { recursive: true });
    } catch (e) {
      await fs.rm(dest, { recursive: true, force: true });
      throw e;
    }
    try {
      await db.query(
        `INSERT INTO reports (id, user_id, slug, revision_id, title, date, tag, tag_color, description, keywords, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          randomUUID(),
          userId,
          slug,
          newRevisionId(),
          t.title,
          t.date,
          t.tag,
          t.tagColor,
          t.description,
          t.keywords,
          sortOrder++,
        ],
      );
    } catch (e) {
      await fs.rm(dest, { recursive: true, force: true });
      throw e;
    }
  }
}

export async function createGuestSessionRecord(userId: string, ttlMinutes = GUEST_TTL_MINUTES) {
  await ensureOtpMigration();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  await db.query(
    `INSERT INTO guest_sessions (user_id, expires_at, payload)
     VALUES ($1, $2, '{}'::jsonb)
     ON CONFLICT (user_id) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
    [userId, expiresAt],
  );
  return expiresAt;
}

export async function destroyGuestUser(userId: string): Promise<void> {
  await deleteUserPermanently(userId, "guest");
}

export async function purgeStaleGuests(): Promise<{ removed: number }> {
  await ensureOtpMigration();
  const stale = await db.query<{ user_id: string }>(
    `SELECT user_id FROM guest_sessions
     WHERE expires_at < NOW()
     ORDER BY expires_at ASC
     LIMIT 100`,
  );
  if (!stale.rows.length) return { removed: 0 };
  let removed = 0;
  for (const r of stale.rows) {
    try {
      await destroyGuestUser(r.user_id);
      removed += 1;
    } catch (error) {
      logger.error("guest-cleanup", "清理过期访客失败，继续处理其他访客", error as Error, {
        userId: r.user_id,
      });
    }
  }
  return { removed };
}

export { dirSizeBytes };

// ── 工具：判断访客会话是否已过期（创建起 60 分钟，不续期）──

export async function isGuestExpired(userId: string): Promise<boolean> {
  await ensureOtpMigration();
  const r = await db.query<{ e: Date }>(
    `SELECT expires_at AS e FROM guest_sessions WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  if (!r.rows.length) return true; // 没有沙箱记录视为过期
  return r.rows[0].e.getTime() < Date.now();
}

/** 读取访客沙箱的到期时间（非访客 / 无记录返回 null） */
export async function getGuestExpiry(
  userId: string,
): Promise<Date | null> {
  await ensureOtpMigration();
  const r = await db.query<{ e: Date }>(
    `SELECT expires_at AS e FROM guest_sessions WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  return r.rows.length ? new Date(r.rows[0].e.getTime()) : null;
}

/**
 * 访客会话到期强制退出：会话属于访客且已过 60 分钟 → 当场销毁沙箱并返回 true，
 * 调用方 redirect('/?guestExpired=1')（登录页会展示「访客体验已结束」提示卡）。
 * 挂在主要页面的会话检查处（/ /home /report /account /shares）；
 * API 层不做逐个拦截（访客场景低频，页面级拦截已覆盖正常浏览路径）。
 */
export async function expireGuestIfNeeded(
  session: { user: { id: string; email: string } } | null | undefined,
): Promise<boolean> {
  if (!session || !isGuestEmail(session.user.email)) return false;
  if (!(await isGuestExpired(session.user.id))) return false;
  await destroyGuestUser(session.user.id);
  return true;
}
