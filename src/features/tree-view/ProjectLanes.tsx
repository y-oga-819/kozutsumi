import type { ProjectKey } from "../../entities/project/types";
import { PROJECTS } from "../../entities/project/projects";
import { laneLeftPx } from "./layout";

type ProjectLanesProps = {
  projectOrder: readonly ProjectKey[];
};

/**
 * プロジェクトごとの縦線（ブランチ）と上部レジェンド。
 */
export function ProjectLanes({ projectOrder }: ProjectLanesProps) {
  return (
    <>
      {projectOrder.map((pk, pi) => (
        <div
          key={pk}
          className="pointer-events-none absolute top-0 bottom-0 z-[1] w-0.5 opacity-30"
          style={{
            left: laneLeftPx(pi),
            background: PROJECTS[pk].color,
          }}
        />
      ))}
      <div className="relative z-[2] flex gap-3 px-4 pb-1.5 pt-3.5">
        {projectOrder.map((k) => (
          <div key={k} className="flex items-center gap-1">
            <div
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: PROJECTS[k].color }}
            />
            <span className="font-jp text-[9px] text-fg-weak">
              {PROJECTS[k].name}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
