"use client";

import { useRouter } from "next/navigation";
import { ProjectForm, type ProjectFormValues } from "@/components/project-form";

export default function NewReportPage() {
  const router = useRouter();

  async function submit(values: ProjectFormValues, file: File | null) {
    const fd = new FormData();
    fd.set("title", values.title);
    fd.set("date", values.date);
    fd.set("tag", values.tag);
    fd.set("tagColor", values.tagColor);
    fd.set("description", values.description);
    fd.set("keywords", values.keywords);
    fd.set("externalNetwork", String(values.externalNetwork));
    fd.set("file", file!);

    const res = await fetch("/api/reports", { method: "POST", body: fd });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      // 上传/校验类错误（如缺少 report.html）显示在报告文件卡内
      return data.error ?? "上传失败，请重试";
    }
    router.push("/home");
    router.refresh();
    return null;
  }

  return (
    <ProjectForm
      heading="新建项目"
      headingDesc="填写项目基础信息并上传工作报告。"
      requireFile
      submitLabel="创建项目"
      submittingLabel="创建中…"
      onSubmit={submit}
    />
  );
}
