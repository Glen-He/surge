import { promises as fs } from "fs";
import path from "path";
import { auth } from "./auth";
import { withStorageLocks } from "./db";
import { logger } from "./logger";
import { newRevisionId } from "./report-capability";
import {
  REPORT_SHARED_DIR,
  REPORT_TEMPLATES_DIR,
  reportDir,
} from "./report-storage";

// 默认管理员账号从环境变量读取（.env.local / 部署环境的 .env）：
// 首次部署时配置 SEED_USER_EMAIL + SEED_USER_PASSWORD，启动会自动创建该用户；
// 未配置则跳过创建（不影响已存在的用户和报告）
const DEFAULT_EMAIL = process.env.SEED_USER_EMAIL;
const DEFAULT_PASSWORD = process.env.SEED_USER_PASSWORD;

// 首次迁移用的静态报告元数据（迁移完成后不再使用）
const LEGACY_REPORTS = [
  {
    slug: "vela",
    title: "Vela — P15/CK2α 候选漏斗主流程",
    date: "2026-08-17",
    tag: "候选筛选",
    tagColor: "#DBEAFE",
    desc: "阶段一 → 阶段四 4B · 候选筛选主流程",
    keywords: "P15,CK2a,CK2,漏斗,funnel,候选,筛选",
  },
  {
    slug: "kttks",
    title: "KTTKS_2 膜内扩散系数分析报告",
    date: "2026-08-17",
    tag: "分子模拟",
    tagColor: "#F3E8FF",
    desc: "7 窗 restrained production · 力自相关 / running integral / cutoff 敏感性 · 交互式图表",
    keywords: "KTTKS2,扩散,diffusivity,膜内,ACF,分子动力学,MD",
  },
  {
    slug: "nexus",
    title: "Nexus 多肽性质预测工具包",
    date: "2026-08-17",
    tag: "工具包",
    tagColor: "#DCFCE7",
    desc: "9 个 feature · 7 个 provider · pepADMET 能力覆盖矩阵 · 架构设计",
    keywords: "peptide,ADMET,预测,LogD,BBB,toxicity,CLI",
  },
];

const TEMPLATES_DIR = REPORT_TEMPLATES_DIR;
const SHARED_DIR = REPORT_SHARED_DIR;

export async function seedDefaultUser() {
  if (!DEFAULT_EMAIL || !DEFAULT_PASSWORD) {
    logger.info("seed", "未配置 SEED_USER_EMAIL / SEED_USER_PASSWORD，跳过默认用户创建");
    return;
  }
  try {
    // instrumentation 已在服务 ready 前完成 auth + 业务迁移；
    // 这里只负责可选的初始数据。
    const context = await auth.$context;
    // 确保默认用户存在
    const adapter = context.internalAdapter;

    const found = await adapter.findUserByEmail(DEFAULT_EMAIL);
    let user = found?.user ?? null;
    if (!user) {
      const created = await adapter.createUser({
        email: DEFAULT_EMAIL,
        name: `user_${crypto.randomUUID()}`,
        emailVerified: true,
      });
      if (!created) {
        logger.error("seed", "默认用户创建失败");
        return;
      }
      user = created;
      logger.info("seed", "默认用户已创建", { email: DEFAULT_EMAIL });
    }

    // Repair a previous partial seed (user committed, credential link failed)
    // without resetting the password of an already configured account.
    const credential = await adapter.findAccountByProviderId(
      user.id,
      "credential",
    );
    if (!credential) {
      const hash = await context.password.hash(DEFAULT_PASSWORD);
      await adapter.linkAccount({
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: hash,
      });
    }

    // 3. 公共资源（echarts）放到 _shared（模板不包含 echarts，从已存在的共享目录保持）
    await fs.mkdir(SHARED_DIR, { recursive: true });

    // 4. 从 templates 复制默认报告到用户目录 + 写数据库（幂等，已存在则跳过）
    let templatesExist = false;
    try {
      await fs.access(TEMPLATES_DIR);
      templatesExist = true;
    } catch {
      templatesExist = false;
    }

    if (templatesExist) {
      await withStorageLocks(user.id, async (client) => {
        for (const legacy of LEGACY_REPORTS) {
          const existing = await client.query(
            "SELECT id FROM reports WHERE user_id = $1 AND slug = $2",
            [user.id, legacy.slug],
          );
          if ((existing.rowCount ?? 0) > 0) continue;

          const userDir = reportDir(user.id, legacy.slug);
          await fs.mkdir(userDir, { recursive: true });
          const srcDir = path.join(
            /* turbopackIgnore: true */ TEMPLATES_DIR,
            legacy.slug,
          );
          await fs.cp(srcDir, userDir, { recursive: true });

          await client.query(
            `INSERT INTO reports (id, user_id, slug, revision_id, title, date, tag, tag_color, description, keywords)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              crypto.randomUUID(),
              user.id,
              legacy.slug,
              newRevisionId(),
              legacy.title,
              legacy.date,
              legacy.tag,
              legacy.tagColor,
              legacy.desc,
              legacy.keywords,
            ],
          );
          logger.info("seed", "默认报告已创建", {
            slug: legacy.slug,
            userId: user.id,
          });
        }
      });
    } else {
      logger.info("seed", "无默认报告模板（reports/templates 不存在），跳过");
    }
  } catch (err) {
    logger.error("seed", "初始化失败", err as Error);
    throw err;
  }
}
