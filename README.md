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
- グローバルモード、レビュー結果の扱い、言語は設定ファイルから読み取ります。
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

`opencode plugin add` は、次のようにプラグインを文字列で追加します。

```jsonc
{
  "plugins": ["github:fateshelled/opencode-permission-gate"]
}
```

オプションを設定するには、この文字列をオブジェクト形式に変更します。

```jsonc
{
  "plugins": [
    {
      "package": "github:fateshelled/opencode-permission-gate",
      "options": {
        "mode": "auto",
        "language": "Japanese",
      },
    },
  ],
}
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
- モデルが失敗した場合、タイムアウトした場合、または不正な出力を返した場合は、
  `on_failure` の設定を使用します（既定は `ask`）。
- プラグインは、判定ごとに JSON を 1 行、監査ログに書き込みます。

モデルが見るのは、アクション、リソース、エージェント名、プロジェクト
ディレクトリ、メタデータです。

モデルは `reason` と `hint` を、`language` オプションで指定した言語で返します。
既定は `Japanese` です。

判定が `ask` のままの場合、プラグインは判定理由を入力欄の上のバナーに
表示します。承認ダイアログと合わせて、何を確認すべきかを判断できます。
承認または辞退すると、バナーは自動で消えます。レビューが失敗し、`on_failure` が
`ask` の場合は、その旨をバナーに表示します。

### モデルの選択

プラグインは次の順序でモデルを使用します。

1. 現在のセッションのモデルを使用します（既定）。
2. `model` オプションに `provider/model` を設定した場合は、そのモデルを使用します。
3. 上記がない場合は、OpenCode の既定モデルを使用します。
4. モデルがない場合は、`on_failure` の設定を使用します（既定は `ask`）。

プラグインはセッションからモデルを読み取り、60 秒間キャッシュします。
強力なセッションモデルはコストと遅延を増やします。

## モード

| モード | 動作 |
| --- | --- |
| `off` | 何もしません。 |
| `dry-run` | アクションをレビューして監査ログを書き込み、判定は変更しません。 |
| `auto` | アクションをレビューし、判定を使用します。 |

既定は `off` です。グローバルモードは `mode` オプションで設定します。
プラグインは設定の読み込み時にこのオプションを読み取り、別のグローバル状態は
保持しません。TUI コマンドは、現在のセッションだけを変更します。

## レビュー結果の扱い

設定ファイルの次のオプションで、レビュー結果ごとの動作を決めます。
TUI コマンドはこれらの値を変更しません。

| オプション | 対象 | 既定値 |
| --- | --- | --- |
| `on_danger` | モデルの `deny`、危険パターン一致 | `deny` |
| `on_ask` | モデルの `ask` | `ask` |
| `on_failure` | レビューの失敗・タイムアウト・不正出力・モデルなし | `ask` |

値は `ask` または `deny` です。`ask` は承認ダイアログを表示し、`deny` は
アクションをブロックします。`on_ask` と `on_failure` に `deny` を設定すると、
判断が必要な正当な操作もブロックされます。承認できないワーカーでのみ使用して
ください。

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
| `mode` | `off` | グローバルモード。プラグインが設定の読み込み時に読み取ります。 |
| `model` | `session` | `session` はセッションモデルを、`provider/model` は固定モデルを使用します。 |
| `variant` | `low` | 明示的な `provider/model` のバリアントで、省略する場合は `none` を使用します。 |
| `timeout_ms` | `2500` | 1 回のレビューの制限時間。 |
| `on_danger` | `deny` | 危険な判定に対する効果。`ask` または `deny`。 |
| `on_ask` | `ask` | モデルの `ask` 判定に対する効果。`ask` または `deny`。 |
| `on_failure` | `ask` | レビュー失敗に対する効果。`ask` または `deny`。 |
| `language` | `Japanese` | `reason` と `hint` を書く言語。 |
| `cache_ttl_ms` | `600000` | 1 つの判定をキャッシュに保持する時間。 |
| `audit_path` | `$XDG_DATA_HOME/opencode/permission-gate.jsonl` | 監査ログのファイル。 |
| `auto_agents` | `[]` | `auto` として扱うエージェント名。セッション個別の上書きが優先されます。 |
| `skip_actions` | `["question","external_directory","subagent"]` | プラグインがレビューしないアクション。 |
| `force_ask_patterns` | `[]` | 危険と見なす追加の正規表現。 |

### すべてのオプション

すべてのオプションを指定した例です。不要な項目は省略できます。表に示した値が
既定値です。配列の項目は例を示しています。`audit_path` は絶対パスで指定して
ください（`~` は展開されません）。

```jsonc
{
  "plugins": [
    {
      "package": "github:fateshelled/opencode-permission-gate",
      "options": {
        "mode": "off",                    // off | dry-run | auto
        "model": "session",               // session | provider/model
        "variant": "low",                 // only for a fixed provider/model
        "timeout_ms": 2500,
        "on_danger": "deny",              // ask | deny
        "on_ask": "ask",                  // ask | deny
        "on_failure": "ask",              // ask | deny
        "language": "Japanese",           // reason and hint language
        "cache_ttl_ms": 600000,
        "audit_path": "/absolute/path/to/permission-gate.jsonl",
        "auto_agents": ["worker"],  // agents that always use auto
        "skip_actions": ["question", "external_directory", "subagent"],
        "force_ask_patterns": ["\\bterraform\\s+destroy\\b", "\\bkubectl\\s+delete\\b"],
      },
    },
  ],
}
```

ローカルクローン用の同じ例は `examples/opencode.jsonc` にあります。

### `auto_agents` の例

`auto_agents` は、指定した名前のエージェントが動かすセッションを `auto` として
扱います。ワーカーやサブエージェントを、毎回 `/permission-gate-auto` を実行せずに
自動判定にしたいときに使います。

```jsonc
{
  "plugins": [
    {
      "package": "github:fateshelled/opencode-permission-gate",
      "options": {
        "mode": "off",
        "auto_agents": ["worker"],
      },
    },
  ],
}
```

モードの優先順位は次のとおりです。

1. セッション個別の上書き（`/permission-gate-off` など）
2. `auto_agents` に一致
3. グローバル `mode`

`auto_agents` はモードだけを変えます。モデル、`timeout_ms`、`on_danger` などは
変わりません。明示的な `deny` ルールも覆しません。

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
