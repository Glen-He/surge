"use client";

import { useState } from "react";
import { Toolbar, ReportList } from "@/components/report-center";
import type { ReportCardView } from "@/lib/report-cards";

// 客户端包装：Toolbar（含新建按钮）+ 数据区，空项目也保留工具栏布局
// 搜索为显式动作：点击/回车后才应用查询
export function ReportBoard({ reports }: { reports: ReportCardView[] }) {
  const [q, setQ] = useState("");

  return (
    <div>
      <Toolbar onSearch={setQ} />

      {reports.length === 0 ? (
        <div className="mt-12 py-16 text-center text-[#6e6e73]">
          <div className="mb-2.5 text-4xl">📄</div>
          你还没有任何项目，点击搜索框旁的「＋」新建
        </div>
      ) : (
        <ReportList reports={reports} q={q} />
      )}
    </div>
  );
}
