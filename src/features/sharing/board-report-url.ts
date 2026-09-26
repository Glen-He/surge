/** 面板网页落地页携带条目标识，授权仍以面板 token、成员关系和面板策略为准。 */
export function boardReportShareUrl(token: string, itemId: string): string {
  return `/share/${encodeURIComponent(token)}?item=${encodeURIComponent(itemId)}`;
}
