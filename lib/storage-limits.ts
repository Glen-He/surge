// 全站上传容量策略（所有用户统一，不限制文件类型与单文件大小）
/** 单次上传的 zip 压缩包大小上限 */
export const MAX_ZIP_BYTES = 50 * 1024 * 1024;
/** 项目解压后总大小上限 */
export const MAX_PROJECT_BYTES = 100 * 1024 * 1024;
/** 压缩包内文件数量上限 */
export const MAX_FILES = 50;
/** 目录深度上限 */
export const MAX_DEPTH = 5;
/** 单用户总存储上限 */
export const MAX_USER_TOTAL_BYTES = 200 * 1024 * 1024;
/** 全站所有用户文件总存储上限：达到即暂停上传 */
export const SITE_TOTAL_CAP_BYTES = 10 * 1024 * 1024 * 1024;
/** 全站预警线：达到即记录后台警告 */
export const SITE_TOTAL_WARN_BYTES = 8 * 1024 * 1024 * 1024;
