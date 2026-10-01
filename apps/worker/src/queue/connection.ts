import { Redis } from "ioredis";

let connectionSingleton: Redis | undefined;

export function getRedisConnection(): Redis {
  if (!connectionSingleton) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL não configurada");
    }
    connectionSingleton = new Redis(redisUrl, { maxRetriesPerRequest: null });
  }
  return connectionSingleton;
}
