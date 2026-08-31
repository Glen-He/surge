import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "sonner";
import { GuestOtpModal } from "@/components/guest-otp-modal";
import { GuestToasts } from "@/components/guest-toasts";
import { connection } from "next/server";

export const metadata: Metadata = {
  title: "工作汇报系统",
  description: "让工作记录更清晰，让每一次汇报都有迹可循。",
};

// Android Chrome 108+：软键盘弹出时压缩 layout viewport，100dvh 随之生效；
// iOS 不支持该行为，由 Modal 内的 visualViewport 兜底。
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // A per-request CSP nonce is attached by proxy.ts. Waiting for the incoming
  // request prevents a build-time HTML shell from carrying a stale nonce.
  await connection();
  return (
    <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster position="top-center" richColors closeButton toastOptions={{ duration: 5000 }} />
        <GuestOtpModal />
        <GuestToasts />
      </body>
    </html>
  );
}
