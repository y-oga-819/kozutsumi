import { getProject } from "../../entities/project/projects";
import { useProjects } from "../../entities/project/ProjectsContext";
import { laneLeftPx } from "./layout";

type ProjectLanesProps = {
  projectOrder: readonly string[];
};

/**
 * プロジェクトごとの縦線（ブランチ）と上部レジェンド。
 */
export function ProjectLanes({ projectOrder }: ProjectLanesProps) {
  const { projectsById } = useProjects();
  return (
    <>
      {projectOrder.map((pk, pi) => (
        <div
          key={pk}
          className="pointer-events-none absolute top-0 bottom-0 z-[1] w-0.5 opacity-30"
          style={{
            left: laneLeftPx(pi),
            background: getProject(projectsById, pk).color,
          }}
        />
      ))}
      <div className="relative z-[2] flex gap-3 px-4 pb-1.5 pt-3.5">
        {projectOrder.map((k) => {
          const p = getProject(projectsById, k);
          return (
            <div key={k} className="flex items-center gap-1">
              <div
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: p.color }}
              />
              <span className="font-jp text-[9px] text-fg-weak">{p.name}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
