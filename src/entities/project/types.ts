export type ProjectKey = "career" | "loadtest" | "slo" | "tasuki";

export type Project = {
  readonly name: string;
  readonly color: string;
};

export type ProjectMap = Readonly<Record<ProjectKey, Project>>;
