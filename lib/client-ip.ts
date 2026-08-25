// 反代后的客户端 IP：取 X-Forwarded-For 的最后一个合法 IP 段。
// 为什么取末段而不是首段：代理为 append 模式时（"客户端伪造值, 真实IP"），
// 首段完全由客户端控制，伪造即可绕过按 IP 的限流/防刷；末段由可信代理追加，
// 不可伪造。代理为 overwrite 模式时唯一一段就是末段——两种拓扑取末段都正确。
// （假设单层可信代理；多层代理链下末段是最近一跳，需按实际拓扑调整。）
const IP_RE = /^[0-9a-fA-F:.]+$/;

export function clientIp(hs: Headers): string {
  const raw = hs.get("x-forwarded-for") ?? "";
  for (const part of raw.split(",").reverse()) {
    const ip = part.trim();
    if (ip && IP_RE.test(ip)) return ip;
  }
  return "unknown";
}
