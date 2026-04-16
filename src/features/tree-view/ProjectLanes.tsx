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
          style={{
            position: "absolute",
            left: laneLeftPx(pi),
            top: 0,
            bottom: 0,
            width: 2,
            background: PROJECTS[pk].color,
            opacity: 0.3,
            zIndex: 1,
            pointerEvents: "none",
          }}
        />
      ))}
      <div
        style={{
          padding: "14px 16px 6px",
          display: "flex",
          gap: 12,
          position: "relative",
          zIndex: 2,
        }}
      >
        {projectOrder.map((k) => (
          <div
            key={k}
            style={{ display: "flex", alignItems: "center", gap: 4 }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: PROJECTS[k].color,
              }}
            />
            <span
              style={{
                fontSize: 9,
                color: "#52525b",
                fontFamily: "'Noto Sans JP', sans-serif",
              }}
            >
              {PROJECTS[k].name}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
