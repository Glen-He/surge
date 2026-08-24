import { promises as fs } from "fs";
import path from "path";
import { auth } from "./auth";
import { db } from "./db";
import { ensureSchema } from "./schema";

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

const TEMPLATES_DIR = path.join(process.cwd(), "reports", "templates");
const USERS_DIR = path.join(process.cwd(), "reports", "users");
const SHARED_DIR = path.join(process.cwd(), "reports", "_shared");

export async function seedDefaultUser() {
  if (!DEFAULT_EMAIL || !DEFAULT_PASSWORD) {
    console.log("[seed] 未配置 SEED_USER_EMAIL / SEED_USER_PASSWORD，跳过默认用户创建");
    return;
  }
  try {
    // 0. 先让 better-auth 初始化并创建自己的表（user/session/account/verification），
    //    否则 ensureSchema 里 reports 的 REFERENCES "user"(id) 会因 user 表不存在而失败
    const context = await auth.$context;
    await context.runMigrations();

    // 1. 建业务表
    await ensureSchema();

    // 2. 确保默认用户存在
    const adapter = context.internalAdapter;

    const found = await adapter.findUserByEmail(DEFAULT_EMAIL);
    let user = found?.user ?? null;
    if (!user) {
      const hash = await context.password.hash(DEFAULT_PASSWORD);
      const created = await adapter.createUser({
        email: DEFAULT_EMAIL,
        name: `user_${crypto.randomUUID()}`,
        emailVerified: true,
      });
      if (!created) {
        console.error("[seed] 默认用户创建失败");
        return;
      }
      await adapter.linkAccount({
        userId: created.id,
        providerId: "credential",
        accountId: created.id,
        password: hash,
      });
      user = created;
      console.log(`[seed] 默认用户已创建: ${DEFAULT_EMAIL}`);
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
      for (const legacy of LEGACY_REPORTS) {
        const existing = await db.query(
          "SELECT id FROM reports WHERE user_id = $1 AND slug = $2",
          [user.id, legacy.slug],
        );
        if ((existing.rowCount ?? 0) > 0) continue;

        // 复制模板文件到用户目录
        const userDir = path.join(USERS_DIR, user.id, legacy.slug);
        await fs.mkdir(userDir, { recursive: true });
        const srcDir = path.join(TEMPLATES_DIR, legacy.slug);
        await fs.cp(srcDir, userDir, { recursive: true });

        // 写数据库
        await db.query(
          `INSERT INTO reports (id, user_id, slug, title, date, tag, tag_color, description, keywords)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            crypto.randomUUID(),
            user.id,
            legacy.slug,
            legacy.title,
            legacy.date,
            legacy.tag,
            legacy.tagColor,
            legacy.desc,
            legacy.keywords,
          ],
        );
        console.log(`[seed] 默认报告已创建: ${legacy.slug} -> ${user.id}`);
      }
    } else {
      console.log("[seed] 无默认报告模板（reports/templates 不存在），跳过");
    }
  } catch (err) {
    console.error("[seed] 初始化失败:", err);
  }
}
