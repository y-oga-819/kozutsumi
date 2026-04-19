import type { HistoryEntry } from "../../entities/task/types";
import { DateGroup } from "./DateGroup";
import { groupByDateDesc } from "./layout";
import { ProjectLanes } from "./ProjectLanes";

type TreeViewProps = {
  historyData: HistoryEntry[];
  projectOrder: readonly string[];
};

/**
 * git log tree 風の履歴ビュー。
 * 縦軸が時間（日付）、横軸がプロジェクト（レーン）。
 */
export function TreeView({ historyData, projectOrder }: TreeViewProps) {
  const dateGroups = groupByDateDesc(historyData);

  return (
    <div className="relative pb-10">
      <ProjectLanes projectOrder={projectOrder} />
      <div className="relative z-[2]">
        {dateGroups.map(([date, items]) => (
          <DateGroup
            key={date}
            date={date}
            items={items}
            projectOrder={projectOrder}
          />
        ))}
      </div>
    </div>
  );
}
