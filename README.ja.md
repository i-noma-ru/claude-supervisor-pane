# claude-supervisor-pane

Claude Code のターミナル画面で使う小さなプラグイン（MOD）です。サブエージェントの実行と、指定したシェルコマンドの実行を、状態と経過秒つきで横のペインに並べます。

English: [README.md](README.md)

画面に出る文言は英語です。

## 使いどころ

- Claude がレビュー役・検証役・調査役などのサブエージェントを何本も走らせていて、会話に出る 1 行の表示では「誰が走っていて、誰が終わり、誰が失敗したか」が追えないとき。
- パイプラインの一部がシェルコマンド（`deploy.sh` やレビュー用スクリプト）で、同じ一覧で見たいとき。`commands` の設定に名前を足します。
- トークンを使わずに見たいとき。ペインは MOD が描き、モデルは見ません。

向かないとき: 画面の無い実行（`claude -p`）、狭いターミナル（横のペインを置く幅が無いときは何も開かず、`/supervisor` はその旨を知らせるだけです）。

## 動くとこう見える

最初の対象の呼び出しが始まると、会話の横に **Supervisors** という題のペインが開きます。1 行が 1 回の呼び出しです。

```
… code-reviewer 12s
✓ test-runner 41s
✗ deploy.sh 3s
done 2 / 3
```

`…` は実行中、`✓` は完了、`✗` は失敗。`/supervisor` で開閉します。

## 動作条件

- Claude Code のプラグインフック（MOD）API を使っています。この API は早期提供の段階で、版によって変わる可能性があります。
- Claude Code 2.1.295・macOS で開発・確認しました。
- Windows は確認していません。

## 導入

このリポジトリをマーケットプレイスとして登録して入れます。

```
claude plugin marketplace add i-noma-ru/claude-supervisor-pane
claude plugin install supervisor-pane@claude-supervisor-pane
```

クローンして、そのセッションだけ読み込むこともできます。

```
claude --plugin-dir /path/to/claude-supervisor-pane
```

## 設定

すべて既定値があるので、設定なしで動きます。変えるときは `/plugin configure supervisor-pane@claude-supervisor-pane` か `/config` で。

| 設定 | 既定 | 意味 |
| --- | --- | --- |
| `agents` | 空 | 一覧に出す `subagent_type`。空ならすべてのサブエージェント。 |
| `commands` | 空 | Bash のコマンドに含まれていたら行にする部分文字列。空ならシェルコマンドは出しません。 |
| `max_rows` | 30 | これを超えたら、終わった行の古いものから落とします。 |

## 動き

- `Agent` ツールの呼び出しで `subagent_type` が一致したとき（`agents` が空なら毎回）、行が始まります。背景で走るサブエージェントは終わる前に呼び出しが返るので、行は実行中のままにして、5 秒ごとにエンジンのエージェント一覧を見て完了・失敗に確定します。
- `Bash` ツールの呼び出しでコマンドが `commands` のどれかを含むとき、行が始まり、呼び出しと一緒に終わります。終了コードが 0 以外、またはエラーの結果なら失敗です。
- 行はセッションの状態に置くので、MOD の再読み込みでは消えません。5 秒のタイマーは再読み込みで止まるので、背景の行の確定は次のセッションからになります。

## 読むもの

`Agent` 呼び出しの `subagent_type` と結果の状態、`Bash` 呼び出しのコマンド文字列、エンジンのエージェント一覧。ファイルは読まず、どこにも送りません。

## テスト

```
claude plugin validate .
claude plugin test .
```

## 補足

- AI（Claude Code）の支援を受けて書いています。
- 同じ作者の MOD: [claude-decision-tracker](https://github.com/i-noma-ru/claude-decision-tracker)・[claude-confirm-gate](https://github.com/i-noma-ru/claude-confirm-gate)。それぞれ独立しています。

## ライセンス

MIT です。[LICENSE](LICENSE) を参照してください。
