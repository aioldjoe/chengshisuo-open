# 列印用中文字型

只在 `@media print` 裡載入（見 `app/globals.css`）。存在的理由是環境不對稱：
真人的 Mac／Windows 有 PingFang／微軟正黑體，字型堆疊裡它們排在前面，這份用不到；
但產 PDF 的 headless Chromium（`lib/pdf.ts`）跑在一個「一個 CJK 字型都沒有」的
機器上，沒有它整份 PDF 是方框。

## 來源與重建

Noto Sans TC（SIL Open Font License 1.1，全文見 `OFL.txt`），
取自 `google/fonts` 的變體字型 `ofl/notosanstc/NotoSansTC[wght].ttf`，
用 fontTools 取 400／600 兩個字重、再切成子集。

**不要直接用 Fontsource 的 `chinese-traditional` 子集**——它漢字齊全，
但整個全形符號區（U+FF00–FFEF）都沒有，中文最常用的逗號「，」會變方框
（2026-08-23 正式站踩過）。字元集要含：常用繁中漢字、U+2000–206F、
U+FF00–FFEF、U+30FB。

重建（需要 `pip install fonttools brotli`）：

```python
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

SRC = "NotoSansTC[wght].ttf"
want = <現有字元集> | set(range(0x2000, 0x2070)) | set(range(0xFF00, 0xFFF0)) | {0x30FB}

for w in (400, 600):
    f = TTFont(SRC)
    instancer.instantiateVariableFont(f, {"wght": w}, inplace=True)
    s = subset.Subsetter(); s.populate(unicodes=want); s.subset(f)
    f.flavor = "woff2"
    f.save(f"noto-sans-tc-{w}.woff2")
```

改完一定要驗覆蓋率（`TTFont(...).getBestCmap()`），別靠眼睛看 PDF。
