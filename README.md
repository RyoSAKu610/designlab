# Safe Mint FingerCheck

OpenSea Drops APIでMint候補を監視し、walletごとにMint transactionを準備しつつ、**秘密鍵は保持せず、最終署名だけRabby等のブラウザwalletに任せる**安全寄りのMint補助ツールです。

## 何をするか

1. OpenSeaのDrop詳細を数秒間隔で確認
2. 現在activeなstage / supply / priceを取得
3. 登録walletごとにOpenSeaのMint transaction生成APIを呼ぶ
4. allowlist外・sold out・上限超過などの失敗を除外
5. transaction targetにon-chain bytecodeがあることを確認
6. Mint valueが設定上限以下であることを確認
7. 指差し確認UIを表示
8. 最後だけRabby/MetaMaskで本人が送信承認

**秘密鍵・seed phrase・wallet private keyをこのrepoや.envに入れないでください。**

## セットアップ

Node.js 20以上を使います。

```bash
git clone https://github.com/RyoSAKu610/designlab.git
cd designlab
cp .env.example .env
```

`.env` の `OPENSEA_API_KEY`, `WALLETS`, `WATCH_SLUGS` を設定します。WALLETSは公開アドレスのみです。

```bash
npm start
```

ブラウザで `http://127.0.0.1:4317` を開きます。

単発検査だけなら:

```bash
npm run check
```

## 安全ゲート

- Robinhood Chain mainnet chain ID = `4663`
- default RPC = `https://rpc.mainnet.chain.robinhood.com`
- `MAX_MINT_VALUE_WEI` を超えるMintはBLOCK
- OpenSea APIがwallet用transactionを生成できない場合はREADYにしない
- transaction targetがEOAならBLOCK
- OpenSea dropが示すcollection contractとtransaction targetが異なる場合は自動ボタンを停止
- 接続中のRabby wallet addressが対象walletと一致しなければ送信停止
- networkがRobinhood Chainでなければ切替要求
- quantityはdefault 1

※ SeaDrop等では正当なmint proxyへ送るケースがあるため、collection contractとtargetが違うケースを単純に悪性とは断定せず、安全側に倒して手動確認扱いにしています。

## OpenSea APIの挙動

Mint transaction APIは、対象walletがallowlist外、mint limit超過、残高不足、supply exhausted等の場合にprecondition failureを返します。そのため、GTD/WL/FCFSの実用上のeligibility検査として利用できます。

## 重要

このツールはtransactionを**準備**しますが、自動署名しません。最終画面ではRabbyのsimulationと送信内容も再確認してください。Free Mintでもgasは必要です。
