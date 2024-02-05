import { STORAGE_KEY } from "@/app/constant";
import { SyncStore } from "@/app/store/sync";
import { corsFetch } from "../cors";
import { chunks } from "../format";

export type UpstashConfig = SyncStore["upstash"];
export type UpStashClient = ReturnType<typeof createUpstashClient>;

export function createUpstashClient(store: SyncStore) {
  const config = store.upstash;
  const storeKey = config.username.length === 0 ? STORAGE_KEY : config.username;
  const chunkCountKey = `${storeKey}-chunk-count`;
  const chunkIndexKey = (i: number) => `${storeKey}-chunk-${i}`;

  const proxyUrl =
    store.useProxy && store.proxyUrl.length > 0 ? store.proxyUrl : undefined;

  return {
    async check() {
      try {
        const res = await corsFetch(this.path(`get/${storeKey}`), {
          method: "GET",
          headers: this.headers(),
          proxyUrl,
        });
        console.log("[Upstash] check", res.status, res.statusText);
        return [200].includes(res.status);
      } catch (e) {
        console.error("[Upstash] failed to check", e);
      }
      return false;
    },

    async redisGet(key: string) {
      const res = await corsFetch(this.path(`get/${key}`), {
        method: "GET",
        headers: this.headers(),
        proxyUrl,
      });

      console.log("[Upstash] get key = ", key, res.status, res.statusText);
      const resJson = (await res.json()) as { result: string };

      return resJson.result;
    },

    async redisSet(key: string, value: string) {
      const res = await corsFetch(this.path(`set/${key}`), {
        method: "POST",
        headers: this.headers(),
        body: value,
        proxyUrl,
      });

      console.log("[Upstash] set key = ", key, res.status, res.statusText);
    },

    async get() {
      const chunkCount = Number(await this.redisGet(chunkCountKey));
      if (!Number.isInteger(chunkCount)) return;

      const chunks = await Promise.all(
        new Array(chunkCount)
          .fill(0)
          .map((_, i) => this.redisGet(chunkIndexKey(i))),
      );
      // console.log("[Upstash] get full chunks", chunks);
      return chunks.join("");
    },

    async set(_: string, value: string) {
      // upstash limit the max request size which is 1Mb for “Free” and “Pay as you go”
      // so we need to split the data to chunks
      let index = 0;
      for await (const chunk of chunks(value)) {
        await this.redisSet(chunkIndexKey(index), chunk);
        index += 1;
      }
      await this.redisSet(chunkCountKey, index.toString());
    },

    async redisDropDatabase() {
      try {
        // Fetch all keys with the application's prefix
        const allKeys = await this.redisKeys(`${storeKey}*`);

        // Delete each key
        await Promise.all(allKeys.map((key) => this.redisDel(key)));

        console.log("[Upstash] Database dropped successfully");
      } catch (e) {
        console.error("[Upstash] Error dropping database", e);
      }
    },

    // Helper function to get all keys with a certain pattern
    async redisKeys(pattern: string) {
      const res = await corsFetch(this.path(`keys/${pattern}`), {
        method: "GET",
        headers: this.headers(),
        proxyUrl,
      });

      if (res.status === 200) {
        const resJson = (await res.json()) as { result: string[] };
        return resJson.result;
      } else {
        console.error(
          "[Upstash] Failed to retrieve keys",
          res.status,
          res.statusText,
        );
        return [];
      }
    },

    // Helper function to delete a key
    async redisDel(key: string) {
      const res = await corsFetch(this.path(`del/${key}`), {
        method: "POST",
        headers: this.headers(),
        proxyUrl,
      });

      if (res.status !== 200) {
        console.error(
          "[Upstash] Failed to delete key",
          key,
          res.status,
          res.statusText,
        );
      }
    },

    headers() {
      return {
        Authorization: `Bearer ${config.apiKey}`,
      };
    },
    path(path: string) {
      let url = config.endpoint;

      if (!url.endsWith("/")) {
        url += "/";
      }

      if (path.startsWith("/")) {
        path = path.slice(1);
      }

      return url + path;
    },
  };
}
