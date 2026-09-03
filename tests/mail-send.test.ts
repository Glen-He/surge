import { beforeEach, describe, expect, it, vi } from "vitest";

// mock nodemailer：sendOtpMail 模块加载期即创建 transport，
// mock 掉 createTransport 可在不连 SMTP 的情况下捕获 sendMail payload。
// vi.mock 工厂会被提升到 import 之前，mock fn 必须用 vi.hoisted 创建
const { sendMailMock } = vi.hoisted(() => ({ sendMailMock: vi.fn() }));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail: sendMailMock }),
  },
}));

import { sendOtpMail } from "@/lib/account";
import { renderOtpEmail } from "@/lib/email-templates";

describe("sendOtpMail：CID inline 附件透传到 nodemailer payload", () => {
  beforeEach(() => {
    sendMailMock.mockReset();
  });

  it("OTP 邮件：payload 携带与 HTML cid 一一对应的 inline 附件", async () => {
    const tpl = renderOtpEmail("login", { code: "123456" });
    await sendOtpMail({
      to: "user@example.test",
      subject: tpl.subject,
      text: tpl.text,
      html: tpl.html,
      attachments: tpl.attachments,
    });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const payload = sendMailMock.mock.calls[0][0] as {
      to: string;
      subject: string;
      text: string;
      html: string;
      attachments: {
        filename: string;
        cid: string;
        contentType: string;
        contentDisposition: string;
        content: Buffer;
      }[];
    };

    expect(payload.to).toBe("user@example.test");
    expect(payload.subject).toBe(tpl.subject);
    expect(payload.text).toBe(tpl.text);
    expect(payload.html).toContain('src="cid:mail-icon-email@surge"');
    expect(payload.html).toContain('src="cid:mail-icon-clock@surge"');

    // 附件结构：cid / filename / contentType / contentDisposition 全部到位
    expect(payload.attachments).toHaveLength(2);
    const cids = payload.attachments.map((a) => a.cid).sort();
    expect(cids).toEqual(["mail-icon-clock@surge", "mail-icon-email@surge"]);
    for (const a of payload.attachments) {
      expect(a.contentType).toBe("image/png");
      expect(a.contentDisposition).toBe("inline");
      expect(a.filename).toMatch(/\.png$/);
      expect(Buffer.isBuffer(a.content)).toBe(true);
    }

    // payload 中 HTML 引用的每个 cid 都有对应附件（双向无多余）
    const htmlCids = [...payload.html.matchAll(/src="cid:([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(htmlCids.sort()).toEqual(cids);
  });

  it("纯文本调用（无 html）：不携带附件", async () => {
    await sendOtpMail({
      to: "user@example.test",
      subject: "标题",
      text: "纯文本",
    });
    const payload = sendMailMock.mock.calls[0][0] as {
      html?: string;
      attachments?: unknown;
    };
    expect(payload.html).toBeUndefined();
    expect(payload.attachments).toBeUndefined();
  });
});
