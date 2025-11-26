import { Redenv } from "@redenv/client";

export const redenv = new Redenv({
  upstash: {
    url: "https://cunning-alien-11827.upstash.io",
    token: "AS4zAAIncDJiOGU1NmQwODQxODY0MzIwODY4OTY1MDI1MmEzZWNjZHAyMTE4Mjc",
  },
  tokenId: "stk_j1S+5SEyJ4kos5mM",
  token: "redenv_sk_Kgdy81fQRnk44XeotuM5qSGivqgCY57a",
  environment: "development",
  project: "fetchy",
  cache: {
    ttl: 60,
  },
});

await redenv.init();
