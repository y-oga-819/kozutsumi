#!/usr/bin/env node
// public schema の snapshot JSON 2 つを比較して、PR コメント用 markdown を stdout に出す。
//
// 使い方:
//   node scripts/db-migration-diff/compare.mjs \
//     <base.json> <pr.json> <schema_diff.txt> <new_migrations.txt> <missing_migrations.txt> \
//     > comment.md
//
// 引数:
//   base.json              : main 適用後の snapshot (snapshot.sql の出力)
//   pr.json                : PR 適用後の snapshot
//   schema_diff.txt        : pg_dump --schema-only の生 diff (diff -u 出力)
//   new_migrations.txt     : PR で新規追加された migration ファイル名 (1 行 1 ファイル)
//   missing_migrations.txt : main にあって HEAD に無い migration ファイル名 (rebase 必要 signal)
//
// 終了コード:
//   0 - 規約違反 (`❌`) なし
//   1 - 規約違反あり (CI で fail させる)
//
// ADR 0023 を参照。

import { readFile } from "node:fs/promises";
import { argv, exit, stdout } from "node:process";

const [, , basePath, prPath, schemaDiffPath, newMigrationsPath, missingMigrationsPath] = argv;

if (!basePath || !prPath || !schemaDiffPath || !newMigrationsPath || !missingMigrationsPath) {
  console.error(
    "usage: compare.mjs <base.json> <pr.json> <schema_diff.txt> <new_migrations.txt> <missing_migrations.txt>",
  );
  exit(2);
}

const [base, pr, schemaDiff, newMigrationsRaw, missingMigrationsRaw] = await Promise.all([
  readJson(basePath),
  readJson(prPath),
  readFile(schemaDiffPath, "utf8").catch(() => ""),
  readFile(newMigrationsPath, "utf8").catch(() => ""),
  readFile(missingMigrationsPath, "utf8").catch(() => ""),
]);

const newMigrations = splitLines(newMigrationsRaw);
const missingMigrations = splitLines(missingMigrationsRaw);

// kind フィルタ。tables (relkind in r/v/m) から table 行だけ抽出する用途。
// 古い snapshot 互換のため kind 未指定は table とみなす。
const isTable = (t) => (t.kind ?? "table") === "table";

const report = buildReport(base, pr);
const assertions = runAssertions(report, pr);
const md = renderMarkdown({
  report,
  assertions,
  schemaDiff,
  newMigrations,
  missingMigrations,
});

stdout.write(md);
exit(assertions.failed ? 1 : 0);

// ---- IO ----

async function readJson(path) {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
}

function splitLines(raw) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

// ---- Diff ----

function buildReport(before, after) {
  return {
    // tables は relkind in ('r','v','m') を含む。kind フィールドで table / view / matview を判別する
    tables: diffByKey(before.tables, after.tables, (t) => `${t.schema}.${t.table}`),
    columns: diffByKey(before.columns, after.columns, (c) => `${c.schema}.${c.table}.${c.column}`),
    constraints: diffByKey(
      before.constraints,
      after.constraints,
      (k) => `${k.schema}.${k.table}.${k.name}`,
    ),
    foreignKeys: diffByKey(
      before.foreign_keys,
      after.foreign_keys,
      (f) => `${f.schema}.${f.table}.${f.name}`,
    ),
    indexes: diffByKey(before.indexes, after.indexes, (i) => `${i.schema}.${i.table}.${i.name}`),
    policies: diffByKey(before.policies, after.policies, (p) => `${p.schema}.${p.table}.${p.name}`),
    enums: diffEnums(before.enums, after.enums),
    // views は view / matview 専用 (definition / security_invoker / security_barrier を含む)
    views: diffByKey(before.views ?? [], after.views ?? [], (v) => `${v.schema}.${v.name}`),
  };
}

// 共通 diff: key で揃えて added / removed / modified に分類する
function diffByKey(beforeArr, afterArr, keyFn) {
  const before = new Map();
  for (const item of beforeArr ?? []) before.set(keyFn(item), item);
  const after = new Map();
  for (const item of afterArr ?? []) after.set(keyFn(item), item);

  const added = [];
  const removed = [];
  const modified = [];

  for (const [key, item] of after) {
    if (!before.has(key)) {
      added.push(item);
    } else if (!shallowEqual(before.get(key), item)) {
      modified.push({ before: before.get(key), after: item });
    }
  }
  for (const [key, item] of before) {
    if (!after.has(key)) removed.push(item);
  }
  return { added, removed, modified };
}

// enum は values 配列まで含めた値追加 / 削除を出すので個別処理
function diffEnums(beforeArr, afterArr) {
  const before = new Map();
  for (const e of beforeArr ?? []) before.set(`${e.schema}.${e.name}`, e);
  const after = new Map();
  for (const e of afterArr ?? []) after.set(`${e.schema}.${e.name}`, e);

  const added = [];
  const removed = [];
  const modified = [];

  for (const [key, e] of after) {
    if (!before.has(key)) {
      added.push(e);
    } else {
      const prev = before.get(key);
      const prevValues = prev.values ?? [];
      const nextValues = e.values ?? [];
      const valuesAdded = nextValues.filter((v) => !prevValues.includes(v));
      const valuesRemoved = prevValues.filter((v) => !nextValues.includes(v));
      if (valuesAdded.length || valuesRemoved.length) {
        modified.push({ before: prev, after: e, valuesAdded, valuesRemoved });
      }
    }
  }
  for (const [key, e] of before) {
    if (!after.has(key)) removed.push(e);
  }
  return { added, removed, modified };
}

function shallowEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- Assertions (kozutsumi 規約チェック) ----

function runAssertions(report, prSnapshot) {
  const errors = [];
  const warnings = [];
  const oks = [];

  // ❌ public の新テーブルに RLS が有効化されていない (view / matview は対象外)
  for (const t of report.tables.added) {
    if (t.schema !== "public") continue;
    if (!isTable(t)) continue;
    if (!t.rls_enabled) {
      errors.push({
        kind: "rls-missing",
        message: `\`${t.schema}.${t.table}\` に RLS が有効化されていません`,
        fix: `\`ALTER TABLE ${t.schema}.${t.table} ENABLE ROW LEVEL SECURITY;\` を追記`,
      });
    } else {
      oks.push(`\`${t.schema}.${t.table}\` で RLS が有効化されている`);
    }
  }

  // ❌ NOT NULL かつ default なしのカラム追加 (既存行で fail) — 通常 table のみ対象
  // 例外: column comment に `@migration-safe-not-null` marker が含まれる場合は skip。
  // 「同一 migration 内で nullable で追加 → backfill → NOT NULL 化を完結させた」ケースを
  // 明示的にオプトアウトするための仕組み (default を付けようがない uuid FK 列など)。
  // marker を使う時は comment に backfill ロジックの所在 (migration ファイル名等) も書くこと。
  const SAFE_NOT_NULL_MARKER = "@migration-safe-not-null";
  for (const c of report.columns.added) {
    if (c.schema !== "public") continue;
    if ((c.kind ?? "table") !== "table") continue; // view / matview の列は対象外
    // 既存テーブルへのカラム追加だけが対象 (新規テーブルは初期データなしなので問題ない)
    const isNewTable = report.tables.added.some(
      (t) => t.schema === c.schema && t.table === c.table,
    );
    if (isNewTable) continue;
    if (c.nullable === "NO" && c.default === null) {
      if (typeof c.comment === "string" && c.comment.includes(SAFE_NOT_NULL_MARKER)) {
        oks.push(
          `\`${c.schema}.${c.table}.${c.column}\` は NOT NULL + default なしだが column comment の \`${SAFE_NOT_NULL_MARKER}\` で同 migration 内 backfill が宣言されている`,
        );
        continue;
      }
      errors.push({
        kind: "not-null-no-default",
        message: `\`${c.schema}.${c.table}.${c.column}\` を NOT NULL かつ default なしで追加 (既存行で違反)`,
        fix: `default 値を付けるか、まず NULL 可で追加 → backfill → NOT NULL 化に分割。同一 migration 内で安全に backfill 完結する場合は column comment に \`${SAFE_NOT_NULL_MARKER}\` を含めて opt-out できる`,
      });
    }
  }

  // ❌ enum 値の削除 (互換性破壊)
  for (const e of report.enums.modified) {
    if (e.valuesRemoved.length > 0) {
      errors.push({
        kind: "enum-value-removed",
        message: `\`${e.before.schema}.${e.before.name}\` から enum 値を削除: ${e.valuesRemoved.map((v) => `\`${v}\``).join(", ")}`,
        fix: "enum 値の削除は互換性破壊。値を残したまま使用箇所を移行する設計にする",
      });
    }
  }

  // ❌ 新規 view / matview に security_invoker = true が指定されていない
  // 未指定だと definer (= 所有者 = postgres) 権限で評価され、呼び出し元の RLS をバイパスする。
  for (const v of report.views.added) {
    if (v.schema !== "public") continue;
    if (!v.security_invoker) {
      errors.push({
        kind: "view-not-security-invoker",
        message: `\`${v.schema}.${v.name}\` (${v.kind}) に \`security_invoker = true\` が指定されていません`,
        fix: `\`CREATE VIEW ... WITH (security_invoker = true) AS ...\` で作成。未指定だと所有者権限で評価され RLS を迂回する`,
      });
    } else {
      oks.push(
        `\`${v.schema}.${v.name}\` (${v.kind}) で \`security_invoker = true\` が指定されている`,
      );
    }
  }

  // ⚠️ 既存 view の security_invoker が外された (true → false)
  for (const m of report.views.modified) {
    if (m.before.security_invoker && !m.after.security_invoker) {
      errors.push({
        kind: "view-security-invoker-removed",
        message: `\`${m.after.schema}.${m.after.name}\` で \`security_invoker\` が外されました (true → false)`,
        fix: "RLS 迂回経路ができるため原則維持する。意図的に外す場合は ADR で根拠を残す",
      });
    }
  }

  // ⚠️ 新規 public テーブルに owner-only ポリシー 4 種が揃っていない (table のみ対象)
  const policiesByTable = new Map();
  for (const p of prSnapshot.policies ?? []) {
    const key = `${p.schema}.${p.table}`;
    if (!policiesByTable.has(key)) policiesByTable.set(key, []);
    policiesByTable.get(key).push(p);
  }
  for (const t of report.tables.added) {
    if (t.schema !== "public") continue;
    if (!isTable(t)) continue;
    const key = `${t.schema}.${t.table}`;
    const policies = policiesByTable.get(key) ?? [];
    const cmds = new Set(policies.map((p) => p.command));
    const need = ["SELECT", "INSERT", "UPDATE", "DELETE"];
    const missing = need.filter((c) => !cmds.has(c) && !cmds.has("ALL"));
    if (missing.length > 0 && t.rls_enabled) {
      warnings.push({
        kind: "policy-incomplete",
        message: `\`${key}\` の policy 不足: ${missing.join(" / ")} が未定義`,
        fix: "4 種すべてに policy を貼るか、ALL command で 1 本にまとめる",
      });
    } else if (missing.length === 0 && t.rls_enabled) {
      oks.push(`\`${key}\` に owner policy 4 種が揃っている`);
    }
  }

  // ⚠️ FK の ON DELETE policy が未指定 (NO ACTION のまま) かつ新規 FK
  for (const f of report.foreignKeys.added) {
    if (f.schema !== "public") continue;
    if (f.delete_rule === "NO ACTION") {
      warnings.push({
        kind: "fk-no-on-delete",
        message: `\`${f.schema}.${f.table}.${f.name}\` の ON DELETE が未指定 (NO ACTION)`,
        fix: "`ON DELETE CASCADE / SET NULL / RESTRICT` のいずれかを明示する",
      });
    } else {
      oks.push(
        `\`${f.schema}.${f.table}.${f.name}\` の ON DELETE が明示されている (\`${f.delete_rule}\`)`,
      );
    }
  }

  return { errors, warnings, oks, failed: errors.length > 0 };
}

// ---- Markdown rendering ----

function renderMarkdown({ report, assertions, schemaDiff, newMigrations, missingMigrations }) {
  const lines = [];
  lines.push("## 🗄️ Migration diff");
  lines.push("");

  // ---- rebase 警告 (main にあって HEAD に無い migration を検出) ----
  if (missingMigrations.length > 0) {
    lines.push(
      `> ⚠️ **main に ${missingMigrations.length} 件の migration があり、このブランチに含まれていません**。`,
    );
    lines.push(">");
    lines.push(
      "> 以下のファイルが main 側で追加されています。rebase / merge して取り込んでください:",
    );
    lines.push(">");
    for (const m of missingMigrations) lines.push(`> - \`${m}\``);
    lines.push(">");
    lines.push(
      "> （以下の diff は **main 現 HEAD vs このブランチ** のため、欠けている migration が「削除」として表示されることがあります）",
    );
    lines.push("");
  }

  // ---- 新規 migration 一覧 ----
  lines.push("**このPRで追加された migration**");
  if (newMigrations.length === 0) {
    lines.push("- _なし_ (`supabase/migrations/**` に新規ファイルなし)");
  } else {
    for (const m of newMigrations) lines.push(`- \`${m}\``);
  }
  lines.push("");
  lines.push(
    "**適用チェック**: ✅ main の上にクリーンに適用できました（ephemeral Supabase local stack）",
  );
  lines.push("");

  // ---- サマリ ----
  const tablesOnly = filterAddedRemovedModified(report.tables, isTable);
  const viewsOnly = report.views;
  lines.push("### サマリ");
  lines.push("");
  lines.push("| カテゴリ | 変更 |");
  lines.push("|---|---|");
  lines.push(`| テーブル | ${summarizeTables(tablesOnly)} |`);
  lines.push(`| ビュー | ${summarizeViews(viewsOnly)} |`);
  lines.push(`| 型 (enum) | ${summarizeEnums(report.enums)} |`);
  lines.push(`| インデックス | ${summarizeSimple(report.indexes)} |`);
  lines.push(`| RLS / ポリシー | ${summarizePolicies(tablesOnly, report.policies)} |`);
  lines.push(`| 制約 | ${summarizeConstraints(report.constraints, report.foreignKeys)} |`);
  lines.push("");

  // ---- 新規テーブル詳細 (view は除外) ----
  const newTables = report.tables.added.filter(isTable);
  if (newTables.length > 0) {
    lines.push("### 新規テーブルの詳細");
    lines.push("");
    for (const t of newTables) {
      lines.push(...renderNewTableSection(t, report));
      lines.push("");
    }
  }

  // ---- 新規 view / matview 詳細 ----
  if (report.views.added.length > 0) {
    lines.push("### 新規 view / matview の詳細");
    lines.push("");
    for (const v of report.views.added) {
      lines.push(...renderNewViewSection(v, report));
      lines.push("");
    }
  }

  // ---- 既存 view の definition 変更 ----
  if (report.views.modified.length > 0) {
    lines.push("### View の変更");
    lines.push("");
    for (const m of report.views.modified) {
      lines.push(`#### \`${m.after.schema}.${m.after.name}\` (${m.after.kind})`);
      lines.push("");
      const flagDiff = [];
      if (m.before.security_invoker !== m.after.security_invoker) {
        flagDiff.push(
          `- \`security_invoker\`: \`${m.before.security_invoker}\` → \`${m.after.security_invoker}\``,
        );
      }
      if (m.before.security_barrier !== m.after.security_barrier) {
        flagDiff.push(
          `- \`security_barrier\`: \`${m.before.security_barrier}\` → \`${m.after.security_barrier}\``,
        );
      }
      if (flagDiff.length) {
        lines.push("**オプション変更**:");
        lines.push(...flagDiff);
        lines.push("");
      }
      if (m.before.definition !== m.after.definition) {
        lines.push("**定義変更** (CREATE OR REPLACE):");
        lines.push("");
        lines.push("```sql");
        lines.push(truncateForComment(m.after.definition ?? "", 4000));
        lines.push("```");
        lines.push("");
      }
    }
  }

  // ---- 既存テーブルへのカラム追加詳細 (view 由来は除外) ----
  const addedColumnsOnExistingTables = report.columns.added.filter((c) => {
    if ((c.kind ?? "table") !== "table") return false;
    return !report.tables.added.some((t) => t.schema === c.schema && t.table === c.table);
  });
  if (addedColumnsOnExistingTables.length > 0) {
    lines.push("### カラムの詳細");
    lines.push("");
    lines.push("| テーブル | 列 | 型 | NULL | デフォルト | 既存行への影響 |");
    lines.push("|---|---|---|---|---|---|");
    for (const c of addedColumnsOnExistingTables) {
      lines.push(
        `| \`${c.schema}.${c.table}\` | \`${c.column}\` | \`${formatType(c)}\` | ${c.nullable === "YES" ? "✅ NULL 可" : "NOT NULL"} | ${formatDefault(c.default)} | ${describeBackfillImpact(c)} |`,
      );
    }
    lines.push("");
  }

  // ---- enum 値の追加 / 削除 ----
  if (report.enums.modified.length > 0) {
    lines.push("### Enum の変更");
    lines.push("");
    for (const e of report.enums.modified) {
      const parts = [];
      if (e.valuesAdded.length) parts.push(`+ ${e.valuesAdded.map((v) => `\`${v}\``).join(", ")}`);
      if (e.valuesRemoved.length)
        parts.push(`- ${e.valuesRemoved.map((v) => `\`${v}\``).join(", ")}`);
      lines.push(`- \`${e.before.schema}.${e.before.name}\`: ${parts.join(" / ")}`);
    }
    lines.push("");
  }

  // ---- 検査 ----
  lines.push("### 検査");
  lines.push("");
  for (const e of assertions.errors) {
    lines.push(`- ❌ **${e.message}**`);
    if (e.fix) lines.push(`  - 修正: ${e.fix}`);
  }
  for (const w of assertions.warnings) {
    lines.push(`- ⚠️ ${w.message}`);
    if (w.fix) lines.push(`  - 修正: ${w.fix}`);
  }
  for (const ok of assertions.oks) {
    lines.push(`- ✅ ${ok}`);
  }
  if (
    assertions.errors.length === 0 &&
    assertions.warnings.length === 0 &&
    assertions.oks.length === 0
  ) {
    lines.push("- ℹ️ 検査対象なし (テーブル / カラム / enum / FK / view の追加変更がない)");
  }
  lines.push("");

  // ---- 生 diff ----
  lines.push("<details>");
  lines.push(
    "<summary>生スキーマ diff (<code>pg_dump --schema-only</code>) — クリックで展開</summary>",
  );
  lines.push("");
  if (schemaDiff.trim() === "") {
    lines.push("_スキーマ差分なし (migration が no-op か、コメントのみ)_");
  } else {
    lines.push("```diff");
    // GitHub のコメントは 65,536 文字まで。長すぎたら切る
    const truncated = truncateForComment(schemaDiff, 50000);
    lines.push(truncated);
    lines.push("```");
  }
  lines.push("");
  lines.push("</details>");
  lines.push("");
  lines.push(
    "<sub>`.github/workflows/ci.yml` の <code>supabase</code> job が生成 / push のたびに更新</sub>",
  );

  return lines.join("\n") + "\n";
}

// ---- Summary helpers ----

function filterAddedRemovedModified(diff, predicate) {
  return {
    added: diff.added.filter(predicate),
    removed: diff.removed.filter(predicate),
    modified: diff.modified.filter((m) => predicate(m.after)),
  };
}

function summarizeTables({ added, removed, modified }) {
  const parts = [];
  if (added.length)
    parts.push(`${added.length} 件追加 (${added.map((t) => `\`${t.table}\``).join(", ")})`);
  if (removed.length)
    parts.push(`⚠️ ${removed.length} 件削除 (${removed.map((t) => `\`${t.table}\``).join(", ")})`);
  if (modified.length)
    parts.push(
      `${modified.length} 件変更 (${modified.map((m) => `\`${m.after.table}\``).join(", ")})`,
    );
  return parts.length ? parts.join(" / ") : "変更なし";
}

function summarizeViews({ added, removed, modified }) {
  const parts = [];
  if (added.length)
    parts.push(
      `${added.length} 件追加 (${added.map((v) => `\`${v.name}\` (${v.kind})`).join(", ")})`,
    );
  if (removed.length)
    parts.push(`⚠️ ${removed.length} 件削除 (${removed.map((v) => `\`${v.name}\``).join(", ")})`);
  if (modified.length)
    parts.push(
      `${modified.length} 件変更 (${modified.map((m) => `\`${m.after.name}\``).join(", ")})`,
    );
  return parts.length ? parts.join(" / ") : "変更なし";
}

function summarizeSimple({ added, removed, modified }) {
  const parts = [];
  if (added.length) parts.push(`${added.length} 件追加`);
  if (removed.length) parts.push(`⚠️ ${removed.length} 件削除`);
  if (modified.length) parts.push(`${modified.length} 件変更`);
  return parts.length ? parts.join(" / ") : "変更なし";
}

function summarizeEnums({ added, removed, modified }) {
  const parts = [];
  if (added.length)
    parts.push(`${added.length} 件追加 (${added.map((e) => `\`${e.name}\``).join(", ")})`);
  if (removed.length)
    parts.push(`⚠️ ${removed.length} 件削除 (${removed.map((e) => `\`${e.name}\``).join(", ")})`);
  if (modified.length) {
    const summaries = modified.map((m) => {
      const a = m.valuesAdded.length ? `+${m.valuesAdded.length}` : "";
      const r = m.valuesRemoved.length ? `-${m.valuesRemoved.length}` : "";
      return `\`${m.before.name}\` (${[a, r].filter(Boolean).join(" / ")})`;
    });
    parts.push(`値変更: ${summaries.join(", ")}`);
  }
  return parts.length ? parts.join(" / ") : "変更なし";
}

function summarizePolicies(tablesOnly, policies) {
  const parts = [];
  const newTablesWithRls = tablesOnly.added.filter((t) => t.rls_enabled);
  if (newTablesWithRls.length) {
    parts.push(`新規テーブル ${newTablesWithRls.length} 件で RLS 有効化`);
  }
  if (policies.added.length) parts.push(`policy ${policies.added.length} 件追加`);
  if (policies.removed.length) parts.push(`⚠️ policy ${policies.removed.length} 件削除`);
  if (policies.modified.length) parts.push(`policy ${policies.modified.length} 件変更`);
  return parts.length ? parts.join(" / ") : "変更なし";
}

function summarizeConstraints(constraints, foreignKeys) {
  const parts = [];
  const fkAdded = foreignKeys.added.length;
  const fkRemoved = foreignKeys.removed.length;
  const otherAdded = constraints.added.length - fkAdded;
  const otherRemoved = constraints.removed.length - fkRemoved;
  if (otherAdded > 0) parts.push(`制約 ${otherAdded} 件追加`);
  if (fkAdded > 0) parts.push(`FK ${fkAdded} 件追加`);
  if (otherRemoved > 0) parts.push(`⚠️ 制約 ${otherRemoved} 件削除`);
  if (fkRemoved > 0) parts.push(`⚠️ FK ${fkRemoved} 件削除`);
  return parts.length ? parts.join(" / ") : "変更なし";
}

// ---- New table detail ----

function renderNewTableSection(t, report) {
  const lines = [];
  lines.push(`#### \`${t.schema}.${t.table}\``);
  lines.push("");

  // Columns
  const columns = report.columns.added.filter(
    (c) => c.schema === t.schema && c.table === t.table && (c.kind ?? "table") === "table",
  );
  if (columns.length) {
    lines.push("| 列 | 型 | NULL | デフォルト |");
    lines.push("|---|---|---|---|");
    for (const c of columns) {
      lines.push(
        `| \`${c.column}\` | \`${formatType(c)}\` | ${c.nullable === "YES" ? "NULL 可" : "NOT NULL"} | ${formatDefault(c.default)} |`,
      );
    }
    lines.push("");
  }

  // FKs
  const fks = report.foreignKeys.added.filter((f) => f.schema === t.schema && f.table === t.table);
  if (fks.length) {
    lines.push("**外部キー**:");
    for (const f of fks) {
      const cols = (f.columns ?? []).map((c) => `\`${c}\``).join(", ");
      const refCols = (f.ref_columns ?? []).map((c) => `\`${c}\``).join(", ");
      lines.push(
        `- ${cols} → \`${f.ref_schema}.${f.ref_table}\`(${refCols}) / **ON DELETE ${f.delete_rule}**`,
      );
    }
    lines.push("");
  }

  // Policies
  const policies = report.policies.added.filter(
    (p) => p.schema === t.schema && p.table === t.table,
  );
  if (policies.length) {
    lines.push("**RLS ポリシー**:");
    lines.push("");
    lines.push("| 種別 | 名前 | 条件 |");
    lines.push("|---|---|---|");
    for (const p of policies) {
      const cond = [];
      if (p.using) cond.push(`USING: \`${truncateInline(p.using)}\``);
      if (p.with_check) cond.push(`WITH CHECK: \`${truncateInline(p.with_check)}\``);
      lines.push(`| ${p.command} | \`${p.name}\` | ${cond.join("<br>")} |`);
    }
    lines.push("");
  }

  if (!t.rls_enabled) {
    lines.push("> ⚠️ このテーブルは RLS が有効化されていません");
    lines.push("");
  }

  return lines;
}

// ---- New view detail ----

function renderNewViewSection(v, report) {
  const lines = [];
  lines.push(`#### \`${v.schema}.${v.name}\` (${v.kind})`);
  lines.push("");

  // セキュリティオプション
  const flags = [];
  flags.push(`- \`security_invoker\`: ${v.security_invoker ? "✅ true" : "❌ false (RLS 迂回)"}`);
  flags.push(`- \`security_barrier\`: \`${v.security_barrier}\``);
  lines.push("**オプション**:");
  lines.push(...flags);
  lines.push("");

  // Columns (information_schema 経由で view 列も取れる)
  const columns = report.columns.added.filter(
    (c) =>
      c.schema === v.schema && c.table === v.name && (c.kind === "view" || c.kind === "matview"),
  );
  if (columns.length) {
    lines.push("**列**:");
    lines.push("");
    lines.push("| 列 | 型 | NULL |");
    lines.push("|---|---|---|");
    for (const c of columns) {
      lines.push(
        `| \`${c.column}\` | \`${formatType(c)}\` | ${c.nullable === "YES" ? "NULL 可" : "NOT NULL"} |`,
      );
    }
    lines.push("");
  }

  // 定義
  if (v.definition) {
    lines.push("**定義**:");
    lines.push("");
    lines.push("```sql");
    lines.push(truncateForComment(v.definition, 4000));
    lines.push("```");
    lines.push("");
  }

  return lines;
}

function describeBackfillImpact(c) {
  if (c.nullable === "YES") {
    return `既存行は ${c.default !== null ? `\`${formatDefault(c.default)}\`` : "`NULL`"} のまま（バックフィル不要）`;
  }
  // NOT NULL
  if (c.default !== null) {
    return `既存行は default \`${formatDefault(c.default)}\` でバックフィル`;
  }
  return "❌ 既存行で NOT NULL 違反 (default なし)";
}

function formatType(c) {
  // information_schema.columns は USER-DEFINED の時 udt_name に enum 名が入る
  if (c.type === "USER-DEFINED" && c.udt) return c.udt;
  return c.type;
}

function formatDefault(d) {
  if (d === null || d === undefined) return "なし";
  return d;
}

function truncateInline(s) {
  if (!s) return "";
  if (s.length <= 80) return s;
  return s.slice(0, 77) + "...";
}

function truncateForComment(s, max) {
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  return head + `\n... (truncated, ${s.length - max} more characters; full diff in workflow logs)`;
}
