"use client";

import { useState } from "react";
import { Toolbar, ReportList } from "@/features/reports/board/report-center";
import { EmptyState } from "@/features/reports/board/empty-state";
import type { ReportCardView } from "@/features/reports/data/report-cards";

// 客户端包装：Toolbar（含新建按钮）+ 数据区，空项目也保留工具栏布局
export function ReportBoard({ reports }: { reports: ReportCardView[] }) {
  const [q, setQ] = useState("");

  return (
    <div>
      <Toolbar onSearch={setQ} />

      {reports.length === 0 ? (
        <div className="mt-12">
          <EmptyState
            icon="doc"
            title="你还没有任何项目"
            hint="点击搜索框旁的「＋」新建第一个报告"
          />
        </div>
      ) : (
        <ReportList reports={reports} q={q} />
      )}
    </div>
  );
}
