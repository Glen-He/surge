import nodemailer from "nodemailer";
import { serverEnv } from "@/infrastructure/environment/server";

// SMTP 发送器：全站唯一 transport（auth hooks 与账户流程共用同一配置）。
// 仅承载环境配置与传输，不包含任何业务判断（游客短路等在 feature 层）。
export const transporter = nodemailer.createTransport({
  host: serverEnv.SMTP_HOST,
  port: serverEnv.SMTP_PORT,
  secure: true,
  auth: {
    user: serverEnv.SMTP_USER,
    pass: serverEnv.SMTP_PASS,
  },
});
