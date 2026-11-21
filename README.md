# opencode-permission-gate

[English](README_eng.md) | 日本語

OpenCode V2 向けの LLM ベースのパーミッションゲートです。
OpenCode が `ask`（ユーザー確認が必要）と判定したアクションを LLM がレビューします。
プラグインはレビュー結果に応じて、判定を `ask` のまま維持するか、`allow` に
変更するか、`deny` にしてブロックします。

## 機能

- `ask` の判定だけをレビューします。
- 明示的な `deny` ルールは最終決定として維持されます。
- 既定では、現在のセッションのモデルを使用します。
- `off`、`dry-run`、`auto` の 3 つのモードがあります。
- グローバルモードと危険なアクションに対する動作は、設定ファイルから読み取ります。
- 危険なアクションをユーザーに送るか、ブロックできます。
- 判定ごとに監査ログを 1 行書き込みます。
- TUI コマンドとステータスダイアログを追加します。

## 要件

- V2 プラグイン API を備えた OpenCode V2 が必要です。
- 短い JSON プロンプトに応答できるチャットモデルが必要です。

## インストール

### GitHub から

```sh
opencode plugin add github:fateshelled/opencode-permission-gate
```

### ローカルクローンから

リポジトリをクローンし、プラグインディレクトリを
`~/.config/opencode/opencode.jsonc` に追加します。

```jsonc
{
  "plugins": [
    {
      "package": "/path/to/opencode-permission-gate",
      "options": {
        "mode": "off",
        "model": "session",
        "on_danger": "deny"
      }
    }
  ]
}
```

パスは設定ファイルからの相対パスでも構いません。

## クイックスタート

1. モードを `dry-run` にします。

   ```text
   /permission-gate-dry-run
   ```

2. 権限が必要なコマンドを実行します。

3. 監査ログを読みます。

   ```text
   ~/.local/share/opencode/permission-gate.jsonl
   ```

4. 判定が正しければ、`auto` にします。

   ```text
   /permission-gate-auto
   ```

## 動作の仕組み

プラグインは `ctx.permission.hook("evaluate")` を登録します。

- OpenCode が設定済みのルールを先に評価します。
- 明示的な `deny` は最終決定であり、プラグインは変更しません。
- プラグインは、`ask` に解決された判定だけをレビューします。
- モデルが失敗した場合、タイムアウトした場合、または不正な出力を返した場合、
  判定は `ask` のままです。
- プラグインは、判定ごとに JSON を 1 行、監査ログに書き込みます。

モデルが見るのは、アクション、リソース、エージェント名、プロジェクト
ディレクトリです。

モデルは `reason` と `hint` を、`language` オプションで指定した言語で返します。
既定は `Japanese` です。

判定が `ask` のままの場合、プラグインは判定理由を入力欄の上のバナーに
表示します。承認ダイアログと合わせて、何を確認すべきかを判断できます。
承認または辞退すると、バナーは自動で消えます。モデルによるレビューが失敗した
場合も、その旨をバナーに表示します。

### モデルの選択

プラグインは次の順序でモデルを使用します。

1. 現在のセッションのモデルを使用します（既定）。
2. `model` オプションに `provider/model` を設定した場合は、そのモデルを使用します。
3. 上記がない場合は、OpenCode の既定モデルを使用します。
4. モデルがない場合、判定は `ask` のままです。

プラグインはセッションからモデルを読み取り、60 秒間キャッシュします。
強力なセッションモデルはコストと遅延を増やします。

## モード

| モード | 動作 |
| --- | --- |
| `off` | 何もしません。 |
| `dry-run` | アクションをレビューして監査ログを書き込み、判定は変更しません。 |
| `auto` | アクションをレビューし、判定を使用します。 |

既定は `off` です。グローバルモードは `mode` オプションで設定します。
プラグインは起動時にこのオプションを読み取り、別のグローバル状態は保持しません。
TUI コマンドは、現在のセッションだけを変更します。

## 危険なアクション

設定ファイルの `on_danger` を `ask` または `deny` に設定します。
TUI コマンドはこの値を変更しません。

- `ask` は、アクションをユーザーに送ります。
- `deny` は、アクションをブロックします。

この設定は、モデルの `deny` 判定と組み込みの危険パターンに適用されます。
既定は `deny` です。

`on_ask` はモデルの `ask` 判定に対する効果、`on_failure` はレビューの失敗に
対する効果です。どちらの既定値も `ask` です。`deny` は、承認できないワーカー
でのみ使用してください。判断が必要な正当な操作もブロックされます。

## コマンド

TUI で次のコマンドを使用します。各コマンドは、現在のセッションだけを変更します。

| コマンド | 結果 |
| --- | --- |
| `/permission-gate` | メニューを開きます。 |
| `/permission-gate-status` | 状態をダイアログに表示します。 |
| `/permission-gate-auto` | このセッションで auto モードを使用します。 |
| `/permission-gate-dry-run` | このセッションで dry-run モードを使用します。 |
| `/permission-gate-off` | このセッションで off モードを使用します。 |
| `/permission-gate-toggle` | auto と off を切り替えます。 |
| `/permission-gate-reset` | セッションの上書きを削除します。 |

他のクライアントは、`text` と `sessionID` を指定して RPC メソッド
`permission-gate.run` を呼び出せます。

## 設定

| オプション | 既定値 | 意味 |
| --- | --- | --- |
| `mode` | `off` | グローバルモード。プラグインが起動時に読み取ります。 |
| `model` | `session` | `session` はセッションモデルを、`provider/model` は固定モデルを使用します。 |
| `variant` | `low` | 明示的な `provider/model` のバリアントで、省略する場合は `none` を使用します。 |
| `timeout_ms` | `2500` | 1 回のレビューの制限時間。 |
| `on_danger` | `deny` | 危険な判定に対する効果。`ask` または `deny`。 |
| `on_ask` | `ask` | モデルの `ask` 判定に対する効果。`ask` または `deny`。 |
| `on_failure` | `ask` | レビュー失敗に対する効果。`ask` または `deny`。 |
| `language` | `Japanese` | `reason` と `hint` を書く言語。 |
| `cache_ttl_ms` | `600000` | 1 つの判定をキャッシュに保持する時間。 |
| `audit_path` | `$XDG_DATA_HOME/opencode/permission-gate.jsonl` | 監査ログのファイル。 |
| `auto_agents` | `[]` | 常に `auto` を使用するエージェントで、セッションの上書きが優先されます。 |
| `skip_actions` | `["question","external_directory","subagent"]` | プラグインがレビューしないアクション。 |
| `force_ask_patterns` | `[]` | 危険と見なす追加の正規表現。 |

`auto_agents` はオーケストレーションに便利です。ワーカーのエージェント名を
設定すると、新しいワーカーセッションは `auto` モードで開始します。

## 監査ログ

各行は次の形式です。

```json
{"at":"...","mode":"auto","session":"ses_...","agent":"worker","action":"shell","resources":["git status"],"effect":"allow","reason":"read only"}
```

ワーカーの実行後にログを読み、判定が正しいことを確認してください。
最初は `dry-run` モードを使用します。

## セキュリティ上の注意

- モデルはコマンド文字列だけを見てファイルの内容は見ないため、コマンドが
  起動するスクリプト内のリスクを見落とすことがあります。
- シェルスキャナは有効のままにしてください。
- 危険パターンとプロジェクトスコープのチェックを維持し、モデルだけを
  制御手段にしないでください。
- 判定は間違うことがあるため、`auto` モードは隔離された worktree の
  ワーカーにだけ使用してください。
- LLM レビューはサンドボックスではなく、プロセスを隔離しません。

## 開発

プラグインのソースは TypeScript です。OpenCode が直接読み込みます。
コントリビューターは型チェックを実行できます。

```sh
bun install
bun run typecheck
```

## ライセンス

MIT
