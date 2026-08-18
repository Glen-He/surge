"use client";

import { useRouter } from "next/navigation";
import { ProjectForm, type ProjectFormValues } from "@/components/project-form";

// 编辑项目：与新建共用表单；报告文件可选更换（不传则保留原文件）
export function EditReportForm({
  slug,
  initial,
}: {
  slug: string;
  initial: ProjectFormValues;
}) {
  const router = useRouter();

  async function submit(values: ProjectFormValues, file: File | null) {
    const fd = new FormData();
    fd.set("title", values.title);
    fd.set("date", values.date);
    fd.set("tag", values.tag);
    fd.set("description", values.description);
    fd.set("keywords", values.keywords);
    if (file) fd.set("file", file);

    const res = await fetch(`/api/reports/${slug}`, {
      method: "PATCH",
      body: fd,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return data.error ?? "保存失败，请重试";
    }
    router.push("/home");
    router.refresh();
    return null;
  }

  return (
    <ProjectForm
      heading="编辑项目"
      headingDesc="修改项目信息，或更换报告文件。"
      initial={initial}
      requireFile={false}
      submitLabel="保存修改"
      submittingLabel="保存中…"
      onSubmit={submit}
    />
  );
}
