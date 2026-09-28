import {
  getIPFromHeader,
  findInvalidTrustedProxies,
} from "@better-auth/core/utils/ip";
import { serverEnv } from "@/infrastructure/environment/server";

/** 所有认证和业务限流使用相同的可信代理、请求头及 IPv6 归一化配置。 */
export function clientIpOptions() {
  const trustedProxies = (serverEnv.TRUSTED_PROXIES ?? "127.0.0.1,::1")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (findInvalidTrustedProxies(trustedProxies).length) {
    throw new Error("TRUSTED_PROXIES must contain valid IP addresses or CIDR ranges");
  }
  return {
    ipAddressHeaders: ["x-forwarded-for"],
    trustedProxies,
    ipv6Subnet: 64,
  };
}

/** 从可信入口提供的 XFF 由右向左剥离代理；无法确定来源时共用保守限流桶。 */
export function clientIp(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for");
  return forwarded
    ? getIPFromHeader(forwarded, clientIpOptions()) ?? "unknown"
    : "unknown";
}
