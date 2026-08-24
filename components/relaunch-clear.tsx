"use client";

import { useEffect } from "react";
import { clearRelaunchIntent } from "@/lib/relaunch-marker";

/**
 * /home 落地即清「认证续跳」标记。
 *
 * 为何水合后清理即可（而非内联 script 在 HTML 解析时执行）：
 * 标记的读取方只有登录页 mount（hasFreshRelaunchIntent），用户此刻
 * 已在 /home，登录页不可能同时存活；从落地到水合的间隙内不存在
 * 读取者。React 组件里的 <script> 在客户端渲染路径永不执行（React 19
 * 会告警），useEffect 是 app router 下的正确姿势。
 */
export function RelaunchClear() {
  useEffect(() => {
    clearRelaunchIntent();
  }, []);
  return null;
}
