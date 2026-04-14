---
name: skill-inspect
description: |
  スキル診断・分析。skill-observations.jsonl を分析し、underperforming なスキルを特定してレポートする。
  TRIGGER when: /skill-inspect、「スキルを診断して」「スキルの改善分析」、同一スキルの観測が累計5の倍数に達した時、fail または user_correction を記録した直後。
  DO NOT TRIGGER when: スキルの修正実行（→ /skill-amend）、スキルの新規作成（→ /skill-creator）。
---

# Skill Inspect — スキル診断・分析

## 概要

蓄積された観測データ（`skill-observations.jsonl`）を分析し、underperforming なスキルを特定してレポートを出力する。

## トリガー

手動トリガー: 「スキルを診断して」「スキルの改善分析」「/skill-inspect」

## ワークフロー

### Phase 0: ローテーション

1. `.claude/state/skill-observations.jsonl` の行数を確認
2. **200行超** の場合、ローテーションを実行:
   a. 全行を読み取り、古い方 100行を集計して `archive_summary` レコードを生成
   b. `archive_summary` + 直近100行 でファイルを上書き
3. `skill-amendments.jsonl` も同様に **100行超** で古い50行を削除（こちらはサマリー不要、完了済みエントリのみ削除）

### Phase 1: データ収集

1. `.claude/state/skill-observations.jsonl` を全件読み取る
2. `_type: "archive_summary"` のレコードがあれば、過去データとして集計に合算する
3. データが0件（サマリー含め）の場合、「観測データがありません」と報告して終了

### Phase 2: スキルごとの集計

各スキルについて以下を算出:

| 指標 | 計算方法 |
|---|---|
| 使用回数 (N) | `user_correction: false` のレコード数 |
| success 率 | `outcome: "success"` / N |
| partial 率 | `outcome: "partial"` / N |
| fail 率 | `outcome: "fail"` / N |
| user_correction 率 | `user_correction: true` のレコード数 / N |
| correction_type 分布 | 各 type のカウント |
| CI pass 率 | `ci_passed: true` / N |

### Phase 2.5: ルール別の違反集計

`rule_violated` が非 null のレコードを集計:

| 指標 | 計算方法 |
|---|---|
| 違反回数 | 各ルール名の出現数 |
| 違反率 | ルール違反数 / 全 user_correction 数 |
| 曖昧フラグ | note に「表現が曖昧」を含む件数 |
| ルール未整備 | `rule_violated: null` かつ note に「ルール未整備」を含む件数 |

### Phase 3: 閾値判定

**N >= 3 のスキルのみ** 判定対象:

| 条件 | 判定 | 推奨アクション |
|---|---|---|
| fail 率 > 30% | 要改善 | 検証手順の具体化、前提条件の明確化 |
| user_correction 率 > 30% | ユーザー修正多発 | 出力基準・例の追加 |
| trigger_mismatch > 20% | トリガー精度問題 | TRIGGER / DO NOT TRIGGER の境界明確化 |
| missing_step > 20% | 手順欠落 | フェーズに具体的チェックリスト追加 |
| output_quality > 20% | 品質低下 | 出力テンプレート・品質基準の追加 |

**ルール閾値判定** （違反 >= 2 のルールが対象）:

| 条件 | 判定 | 推奨アクション |
|---|---|---|
| 同一ルール違反 >= 3 | ルール無効化 | ルール文の強化・具体例追加 |
| 曖昧フラグ >= 2 | 表現不明瞭 | 判断基準の明確化・境界条件の追記 |
| ルール未整備が集中する領域 | カバレッジ不足 | 新規ルール作成を提案 |

### Phase 4: Amendment 評価

1. `.claude/state/skill-amendments.jsonl` を読み取る
2. `status: "evaluating"` のエントリを検出
3. 修正後の観測データ（修正日以降）を baseline と比較:
   - success率が +10% 以上改善 → `status: "improved"` に更新
   - 変化なし（±5%）→ `status: "neutral"` に更新
   - 悪化（-5% 以上）→ ロールバック提案
4. 評価ウィンドウ: 修正後 **5回使用** or **7日間** のいずれか早い方

### Phase 5: レポート出力

以下の形式でユーザーに表示:

```
## スキル診断レポート — YYYY-MM-DD

### サマリー
- 観測レコード数: X
- 対象スキル数: Y
- 要改善スキル: Z

### スキル別分析

#### {スキル名} (N=X)
- success: X% | partial: X% | fail: X%
- ユーザー修正率: X%
- 検出パターン: {パターン名}
- 推奨: {推奨アクション}

### ルール有効性

| ルール | 違反数 | 曖昧 | 判定 |
|---|---|---|---|
| {ルール名} | X | Y | {無効化 / 表現不明瞭 / 有効} |

#### ルール未整備領域
- {領域}: X件 → 新規ルール作成を推奨

### Amendment 評価
- {スキル名}: {status} (baseline: X% → current: Y%)

### 次のアクション
- skill-amend で {スキル名} を改善する
- {ルール名} の強化を検討する
```

## 注意事項

- 分析は読み取り専用。ファイル変更は Amendment 評価の status 更新のみ
- N < 3 のスキルは「データ不足」として参考情報のみ表示
- 全スキルが success 率 90% 以上なら「健全」と報告
