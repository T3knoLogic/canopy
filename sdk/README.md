# @t3kno/canopy-connect

Open the hosted [Canopy](https://7h6n6-eqaaa-aaaau-ag6da-cai.icp0.io/) wallet. This package does not request signatures and does not move ICP.

```js
import { openCanopy, canopyUrl, CANOPY_DERIVATION_ORIGIN } from "./canopy.js";

openCanopy({ tab: "tokens" });
```

Full contract: [../docs/INTEGRATION.md](../docs/INTEGRATION.md).
