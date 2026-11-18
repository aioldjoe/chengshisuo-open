#!/usr/bin/env bash
# 把 brand/src/*.html 用本機 Chrome 無頭截成 PNG。
# 為什麼不用 next/og：satori 要自備中文字型檔，一個「成」字得塞整套 Noto；
# 這裡直接借系統的 PingFang，跟網頁上看到的方章是同一個字型。
# 只有換 logo 或文案時才需要重跑；產物已進版控。
set -euo pipefail
cd "$(dirname "$0")"

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || { echo "找不到 Chrome：$CHROME（可用 CHROME=... 指定）" >&2; exit 1; }

shot() { # shot <src.html> <WxH> <out.png>
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 \
    --window-size="$2" --screenshot="$3" "file://$PWD/src/$1" 2>/dev/null
  echo "$3"
}

shot icon.html          192,192   ../app/icon.png            # favicon／頁籤（Next 會自動掛 <link rel=icon>）
shot fullbleed.html     640,640   line-avatar.png            # LINE 官方帳號頭像（LINE 自己裁圓）
sips -z 180 180 line-avatar.png --out ../app/apple-icon.png >/dev/null   # iOS 加到主畫面（iOS 自己套圓角）
shot mark-chengshi.html 512,512   mark-chengshi.png          # 成事章 512px，社群、簡報通用
shot og.html            1200,630  ../app/opengraph-image.png # 分享到 LINE／FB／Slack 的預覽卡
shot richmenu.html      2500,1686 richmenu.png               # 圖文選單（pnpm setup:richmenu 會上傳）
cp ../app/opengraph-image.png ../app/twitter-image.png
