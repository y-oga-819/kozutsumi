/**
 * Project (DB: public.projects) と 1:1 対応。
 * id は UUID (DB から発行) だが、PoC のシード段階では slug ("career" など) を流用する。
 */
export type Project = {
  id: string;
  name: string;
  color: string;
  isPrimary: boolean;
  createdAt: string;
};

/**
 * Phase 1 初期段階ではプロジェクトを動的に追加できる設計のため、
 * ProjectKey は固定 union ではなく Project.id を指す文字列エイリアス。
 */
export type ProjectKey = string;

export type ProjectMap = Readonly<Record<string, Project>>;
