#!/bin/bash
set -e
cd "$(dirname "$0")"
if [ ! -f .env ]; then cp .env.example .env; fi
printf '\nSafe Mint FingerCheck setup\n'
printf '公開ウォレットアドレスをカンマ区切りで入力してください。秘密鍵/seedは絶対に入力しないでください。\n> '
read WALLETS_INPUT
python3 - "$WALLETS_INPUT" <<'PY'
import re,sys
p='.env'
wallets=sys.argv[1].strip()
vals=[x.strip() for x in wallets.split(',') if x.strip()]
if not vals or any(not re.fullmatch(r'0x[0-9a-fA-F]{40}',x) for x in vals):
    raise SystemExit('ウォレット形式が不正です')
s=open(p).read()
s=re.sub(r'^WALLETS=.*$', 'WALLETS='+','.join(vals), s, flags=re.M)
open(p,'w').write(s)
PY
printf '\nOpenSea API keyを入力してください（空欄なら後で.envを編集）。\n> '
read API_KEY
if [ -n "$API_KEY" ]; then
python3 - "$API_KEY" <<'PY'
import re,sys
p='.env'; key=sys.argv[1].strip(); s=open(p).read(); s=re.sub(r'^OPENSEA_API_KEY=.*$', 'OPENSEA_API_KEY='+key, s, flags=re.M); open(p,'w').write(s)
PY
fi
chmod 600 .env
printf '\n設定完了。.env はGitにコミットされません。\n次に start.command をダブルクリックしてください。\n'
