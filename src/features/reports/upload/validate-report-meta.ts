import { LIMITS, charWeight } from "@/features/reports/upload/char-limit";
import { DEFAULT_TAG_COLOR, isTagColor } from "@/features/reports/tag-colors";
import { uploadFailure, type UploadFailure } from "@/features/reports/upload/upload-errors";

// 报告元信息校验：纯函数、无 IO，供上传 / 替换 / 编辑元信息三条流程复用。

export type ReportMeta = {
  title: string;
  date: string;
  tag: string;
  tagColor: string;
  description: string;
  keywords: string;
};

/** 字段校验（两套端点同一规则）：非法时返回结构化错误。 */
export function validateReportMeta(meta: ReportMeta): UploadFailure | null {
  if (!meta.title || !meta.date) {
    return uploadFailure("META_TITLE_DATE_REQUIRED");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) {
    return uploadFailure("META_DATE_FORMAT");
  }
  const [year, month, day] = meta.date.split("-").map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    return uploadFailure("META_DATE_INVALID");
  }
  if (meta.tag.length > LIMITS.tag) {
    return uploadFailure("META_TAG_TOO_LONG", { max: LIMITS.tag });
  }
  if (charWeight(meta.title) > LIMITS.title) {
    return uploadFailure("META_TITLE_TOO_LONG", { max: LIMITS.title });
  }
  if (charWeight(meta.keywords) > LIMITS.keywords) {
    return uploadFailure("META_KEYWORDS_TOO_LONG", {
      max: LIMITS.keywords,
    });
  }
  if (charWeight(meta.description) > LIMITS.description) {
    return uploadFailure("META_DESCRIPTION_TOO_LONG", {
      max: LIMITS.description,
    });
  }
  return null;
}

/** 从 FormData 提取并规范化元信息（非法 tagColor 回退默认色） */
export function metaFromForm(form: FormData): ReportMeta {
  const tagColorRaw = String(form.get("tagColor") ?? "").trim();
  return {
    title: String(form.get("title") ?? "").trim(),
    date: String(form.get("date") ?? "").trim(),
    tag: String(form.get("tag") ?? "").trim(),
    tagColor: isTagColor(tagColorRaw) ? tagColorRaw : DEFAULT_TAG_COLOR,
    description: String(form.get("description") ?? "").trim(),
    keywords: String(form.get("keywords") ?? "").trim(),
  };
}
