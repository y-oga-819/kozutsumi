"use client";

import { createContext, useContext, useMemo } from "react";

import { FALLBACK_PROJECT, indexProjectsById } from "./projects";
import type { Project } from "./types";

type ProjectsContextValue = {
  projects: readonly Project[];
  projectsById: Record<string, Project>;
};

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

export function ProjectsProvider({
  projects,
  children,
}: {
  projects: readonly Project[];
  children: React.ReactNode;
}) {
  const value = useMemo<ProjectsContextValue>(
    () => ({ projects, projectsById: indexProjectsById(projects) }),
    [projects],
  );
  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}

/**
 * 未提供時は空配列と fallback 1 件のみのマップを返す (unit テストで Provider 包むのを省略可)。
 */
export function useProjects(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext);
  if (!ctx) {
    return {
      projects: [],
      projectsById: { [FALLBACK_PROJECT.id]: FALLBACK_PROJECT },
    };
  }
  return ctx;
}
