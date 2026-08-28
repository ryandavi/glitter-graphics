#!/usr/bin/env bash
# Regenerate data/brushes.json + images/brushes/<pack>/ from the .abr sources in
# tools/brush-sources/. Provenance-as-code: every pack's attribution lives here.
# Usage:  node tools/abr-import.js …   (this just calls it once per pack)
#   NODE=/path/to/node tools/rebuild-brushes.sh
set -euo pipefail
cd "$(dirname "$0")/.."

NODE="${NODE:-node}"
SRC=tools/brush-sources

run() { "$NODE" tools/abr-import.js "$@"; echo; }

rm -f data/brushes.json
rm -rf images/brushes/swirlies images/brushes/swirlies-ii images/brushes/sparkles \
       images/brushes/stardust images/brushes/heartattack

# ---- bruisedxheart.org (via Belle — Salvaged) --------------------------------
BXH=(
  --author "bruisedxheart.org"
  --author-url "https://web.archive.org/web/20050514023929/http://bruisedxheart.org/"
  --archived-by "Belle — Salvaged"
  --archive-url "https://salvaged.nu/2022/03/24/brush-packs-from-bruisedxheartorg/"
  --license unknown
  --notes "Original brushes from bruisedxheart.org (defunct; Wayback capture only). Preserved and re-shared by Belle of Salvaged as an ABR archival effort; included here in the same spirit. Happy to further credit the original creator or remove on request."
)
run "$SRC/BHBrush04Swirlies.abr"  --pack swirlies    --label "Swirlies"    --order 10 \
    --tags swirl,flourish,decorative,y2k --categories ornament "${BXH[@]}"
run "$SRC/bhbrush05swirlies2.abr" --pack swirlies-ii --label "Swirlies II" --order 20 \
    --tags swirl,flourish,decorative,y2k --categories ornament "${BXH[@]}"
run "$SRC/bhbrush43.abr"          --pack sparkles    --label "Sparkles"    --order 30 \
    --tags sparkle,star,glitter,y2k --categories sparkle "${BXH[@]}"

# ---- at0mica.net / © Heather Onnen (via Belle — Salvaged) -------------------
AT0=(
  --author "Heather Onnen — at0mica.net"
  --author-url "https://web.archive.org/web/20170203085633/http://www.at0mica.net/goodies/brushes/"
  --archived-by "Belle — Salvaged"
  --archive-url "https://salvaged.nu/2023/05/22/17x-brushes-from-at0mica-net/"
  --license personal-use
  --notes "© Heather Onnen (at0mica.net, defunct; Wayback capture only). The .abr embeds a NO REDISTRIBUTING credit stamp (dropped on import). Preserved by Belle of Salvaged; personal-use only, will remove on the creator's request."
)
run "$SRC/stardust_ps/at0mica_net-stardust.abr"       --pack stardust    --label "Stardust"     --order 40 \
    --tags sparkle,star,glitter,scatter,y2k --categories sparkle "${AT0[@]}"
# sample 1 (422x192) is the "NO REDISTRIBUTING" credit stamp — not a usable brush.
# --keep-plain keeps a plain heart stamp alongside the scatter brush.
run "$SRC/heartattack_ps/at0mica_net-heartattack.abr" --pack heartattack --label "Heart Attack" --order 50 \
    --tags heart,love,scatter,y2k --categories heart --drop-sample 1 --keep-plain "${AT0[@]}"

echo "done — $("$NODE" -e 'const m=require("./data/brushes.json");console.log(m.packs.length+" packs, "+m.packs.reduce((n,p)=>n+p.brushes.length,0)+" brushes")')"
