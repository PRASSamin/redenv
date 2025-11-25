import { Redenv } from "@redenv/client";

export const client = new Redenv({
  upstash: {
    url: "https://cunning-alien-11827.upstash.io",
    token: "AS4zAAIncDJiOGU1NmQwODQxODY0MzIwODY4OTY1MDI1MmEzZWNjZHAyMTE4Mjc",
  },
  tokenId: "stk_fqFYGADG20WQE8It",
  token: "redenv_sk_CzHO-1rUGw1DUzERdLmIt0EQE4MQiQKi",
  environment: "development",
  project: "pras",
  cache: {
    ttl: 60
  },
});

await client.init();
