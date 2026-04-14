---
name: skill-amend
description: |
  スキル・ルールの改善。観測データに基づき underperforming なスキルの SKILL.md やルールを修正する。
  TRIGGER when: /skill-amend、「スキルを修正して」「診断結果を反映して」「スキルを改善して」、skill-inspect が要改善を検出した後。
  DO NOT TRIGGER when: スキルの新規作成（→ /skill-creator）、スキルの診断のみ（→ /skill-inspect）。
---

# Skill Amend — スキル・ルール改善

## 概要

skill-inspect の診断結果に基づき、underperforming なスキルの SKILL.md やルールの `.md` を改善する。

## トリガー

手動トリガー: 「スキルを修正して」「診断結果を反映して」「/skill-amend」「スキルを改善して」

## ワークフロー

### Phase 1: 診断読み取り

1. `.claude/state/skill-observations.jsonl` を読み取る
2. `.claude/state/skill-amendments.jsonl` を読み取る
3. 要改善スキルを特定する（skill-inspect と同じ閾値判定ロジック）
4. 対象スキルがなければ「改善対象なし」と報告して終了

### Phase 2: 改善対象の選定

ユーザーに改善対象の一覧を提示（スキルとルール両方）:

```
## 改善候補

### スキル
1. {スキル名} — {検出パターン} (fail率: X%, 修正率: Y%)

### ルール
2. {ルール名} — {判定} (違反: X回, 曖昧: Y回)
3. [新規ルール提案] {領域} — ルール未整備 (X件)

どれを改善しますか？（番号 or 名前）
```

### Phase 3: バックアップ

対象ファイルをバックアップする。

- スキル: `SKILL.md` → `SKILL.md.bak`
- ルール: `{rule}.md` → `{rule}.md.bak`

```bash
cp .claude/skills/{skill-name}/SKILL.md .claude/skills/{skill-name}/SKILL.md.bak
# or
cp .claude/rules/{rule-name}.md .claude/rules/{rule-name}.md.bak
```

### Phase 4: 改善案生成

検出パターンに応じた改善を適用:

**スキル改善:**

| パターン | 改善内容 |
|---|---|
| CI ループ (fail/partial 連続) | 検証手順の具体化、前提条件チェックの追加 |
| トリガー不一致 | TRIGGER / DO NOT TRIGGER セクションの境界条件追加 |
| 手順欠落 | フェーズにチェックリスト追加、ガードレール追加 |
| 品質低下 | 出力例・品質基準・テンプレートの追加 |

**ルール改善:**

| 判定 | 改善内容 |
|---|---|
| ルール無効化（同一違反 >= 3） | ルール文の強化、具体例・禁止例の追加、MUST/SHOULD の明確化 |
| 表現不明瞭（曖昧フラグ >= 2） | 判断基準の数値化、境界条件の追記、OK/NG 例の追加 |
| ルール未整備 | 新規ルールファイルの作成を提案 |

改善案を **diff 形式** でユーザーに提示:

```
## {スキル名} 改善案

### 検出パターン: {パターン名}
### 根拠: {観測データの要約}

### 変更内容:
- {変更1の説明}
- {変更2の説明}

### Diff:
{変更前後の diff}

この変更を適用しますか？ (y/n)
```

### Phase 5: 承認ゲート

**ユーザーの明示的な承認を得てから** SKILL.md を更新する。

### Phase 6: 適用・記録

1. SKILL.md を更新する
2. `.claude/state/skill-amendments.jsonl` に追記:

```json
{
  "ts": "ISO8601",
  "skill": "スキル名 or rule:{ルール名}",
  "pattern": "ci_loop | trigger_mismatch | missing_step | output_quality | rule_ineffective | rule_ambiguous | rule_missing",
  "change_summary": "変更内容の要約",
  "baseline_success_rate": 0.6,
  "observation_count_before": 5,
  "status": "evaluating"
}
```

3. `tasks/lessons.md` にパターンを追記:

```markdown
### YYYY-MM-DD: {スキル名} の {パターン名}
- **観察**: 何が起きたか
- **原因**: なぜ起きたか
- **修正**: 何を変えたか
- **結果**: 評価中（修正後5回使用 or 7日後に判定）
```

### ロールバック

skill-inspect が悪化を検出した場合、または手動で「ロールバックして」と依頼された場合:

1. `SKILL.md.bak` から復元する
2. `skill-amendments.jsonl` の該当エントリの status を `rolled_back` に更新
3. `tasks/lessons.md` に結果を追記

## 注意事項

- **ユーザー承認なしに SKILL.md を変更しない**
- 一度に改善するスキルは1つずつ（変更の影響を追跡しやすくするため）
- バックアップは直前の1世代のみ保持
- 改善案は観測データに基づく具体的なものにする（抽象的な「改善」は避ける）
