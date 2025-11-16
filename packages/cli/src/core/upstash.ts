import { Redis } from "@upstash/redis";
import { loadGlobalConfig } from "./config";

let redisInstance: Redis;

function initializeRedis() {
  if (!redisInstance) {
    const config = loadGlobalConfig();
    redisInstance = new Redis({
      url: config.url,
      token: config.token,
    });
  }
  return redisInstance;
}

export const redis = new Proxy(
  {},
  {
    get: (_, prop) => {
      const redis = initializeRedis();
      const property = redis[prop as keyof Redis];
      if (typeof property === "function") {
        return property.bind(redis);
      }
      return property;
    },
  }
) as Redis;