---
name: kozutsumi-frontend-a11y
description: kozutsumi の React component (`src/**/*.tsx`) を新規実装・既存構造変更する、modal / dialog / tabs / form / icon-only ボタンを書く、`role` / `aria-*` の選択に迷う、PR / branch の a11y を review する、e2e で locator が衝突した・書きづらいと感じた、などの作業で必ず参照する。a11y は実ユーザー (スクリーンリーダー / キーボード操作) と e2e の semantic locator の両方の品質を支える基盤として扱う。
---

# kozutsumi フロントエンド a11y レビュー

このリポジトリのフロントエンド component を書く・review するときの a11y ルール。
**実ユーザーの a11y と e2e locator の robust さは同じ問題**（semantic 構造が立っているか）として扱う。

本 skill は以下の場面で必ず参照する:

- 新しい React component を作る / 構造を大きく変える
- modal / dialog / tabs / form / icon-only ボタン を書く
- `role` / `aria-*` の選択に迷う
- PR / branch を a11y 観点で review する
- e2e の locator が衝突した・書きづらい（=semantic 不足のシグナル）

---

## 1. 原則

**semantic role / aria 属性で構造を立てる**ことを優先し、テスト側の matcher (`exact:true` / `nth` / 専用 testid) で誤魔化さない。

理由:

- スクリーンリーダーが正しく読み上げる（タブとして / モーダル境界として / 状態として）
- キーボード操作の挙動がブラウザ既定で適切になる
- Playwright の `getByRole` が semantic に書ける（`getByRole("tab")` が「tab だけ」マッチする）
- locator 衝突は **構造不足のシグナル**。matcher で潰すのは症状抑制

`exact:true` / `data-testid` を使うのは:

- 上記 semantic では本質的に区別できない場合（似たラベルが意図的に存在する等）
- a11y 上 semantic を変えたくないが、テスト側で 1 つに絞る必要がある場合

の **last resort**。

---

## 2. Canonical パターン

### 2.1 Modal / オーバーレイ → `role="dialog"` + `aria-modal`

```tsx
<div
  role="dialog"
  aria-modal="true"
  aria-label="追加メニュー"  // 不可視タイトルがある場合は aria-labelledby="<id>"
  className="fixed inset-0 z-[210] ..."
>
  <div onClick={onClose} className="absolute inset-0 bg-black/60 ..." />
  <div className="relative ...">{/* content */}</div>
</div>
```

- `role="dialog"` + `aria-modal="true"` は必須セット
- 名前は `aria-label` か、内部にタイトル要素があれば `aria-labelledby="<id>"`
- e2e: `page.getByRole("dialog", { name: "..." })` で scope できる

参考実装: `src/features/add-forms/AddPanel.tsx`, `src/features/task-stack/PauseReasonModal.tsx`（commit `877eae2`）。

### 2.2 タブ群 → `role="tablist"` + `role="tab"` + `aria-selected`

```tsx
<div role="tablist" aria-label="追加メニュー" className="...">
  {tabs.map((t) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === t.key}
      key={t.key}
      onClick={() => setTab(t.key)}
    >
      {t.label}
    </button>
  ))}
</div>
```

- bare `<button>` のままタブとして使うのは NG（スクリーンリーダーがタブ群と認識しない / e2e で他の button と衝突する）
- e2e: `dialog.getByRole("tab", { name: "プロジェクト" })` で role=button のボタンと衝突しない

### 2.3 Form ラベル

kozutsumi では `<label>` で input を **wrap する**スタイルで統一:

```tsx
<label className="flex flex-col gap-1">
  <span className="...">名前</span>
  <input type="text" value={...} />
</label>
```

- `htmlFor` + `id` を使ってもよいが、wrap 形のほうが id 重複が起きないので優先
- e2e: `page.getByLabel("名前")` で取れる

### 2.4 Icon-only ボタン → `aria-label` 必須

```tsx
<button type="button" aria-label="新規追加" onClick={...}>
  <PlusIcon />
</button>
```

- アイコンだけのボタンは `aria-label` がないとスクリーンリーダーで意味不明
- ラベルテキストとアイコンが両方あるなら `aria-label` 不要（textContent が accessible name になる）

### 2.5 Distinguishability — ボタン名の substring 衝突を避ける

`getByRole` の `name` はデフォルトで substring 一致。
**意図せず substring 包含関係になっているボタン名は構造の問題**として扱う。

実例（解決済み, ADR 0011 / commit `877eae2`）:

| ボタン A | ボタン B | 衝突理由 | 解決 |
|---|---|---|---|
| AddButton aria-label="新規追加" | submit button "追加" | "新規追加" は "追加" を含む | submit を dialog scope 内で取る (1.1 参照) |
| tab button "プロジェクト" | EmptyProjectsNotice button "プロジェクトを先に作る" | substring 包含 | tab を `role="tab"` にする (2.2 参照) |

**原則**: 衝突を見つけたら、まず役割が違うはず。`role` / scope (`role="dialog"` 内など) で分離できないか検討する。それでも本当に同名 button が並ぶなら `exact:true`。

---

## 3. レビュー時のチェックリスト

PR / branch を見るとき、以下を順に確認する:

- [ ] **fixed inset-0 でオーバーレイを作っている要素**に `role="dialog"` + `aria-modal="true"` + 名前があるか
- [ ] **タブ的に動く button 群**に `role="tablist"` + `role="tab"` + `aria-selected` があるか
- [ ] **アイコンのみのボタン**に `aria-label` があるか
- [ ] **Form の input/select/textarea** が `<label>` で wrap されているか（または htmlFor）
- [ ] **ボタンの accessible name** が他のボタン名と substring 包含関係になっていないか（包含なら role / scope で分離する）
- [ ] **エラー / ステータス通知**に `role="alert"` / `role="status"` が必要なら付いているか
- [ ] **e2e spec で `exact:true` / `nth` / 単独 testid に依存している locator** がある場合、本当に semantic 不足ではないか確認する

---

## 4. 関連

- ADR 0011（e2e 基盤）— a11y 構造が e2e の頑健性を支える前提
- `kozutsumi-flow` skill — PR / 起票運用
- `/review` skill — branch / PR レビューの一般運用。本 skill のチェックリストは review 時にも踏む
