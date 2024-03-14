import { getClientConfig } from "../config/client";
import { Updater } from "../typing";
import { ApiPath, STORAGE_KEY, StoreKey } from "../constant";
import { createPersistStore } from "../utils/store";
import {
  AppState,
  getLocalAppState,
  GetStoreState,
  mergeAppState,
  setLocalAppState,
} from "../utils/sync";
import { downloadAs, readFromFile } from "../utils";
import { showToast } from "../components/ui-lib";
import Locale from "../locales";
import { createSyncClient, ProviderType } from "../utils/cloud";
import { corsPath } from "../utils/cors";

export interface WebDavConfig {
  server: string;
  username: string;
  password: string;
}

const isApp = !!getClientConfig()?.isApp;
export type SyncStore = GetStoreState<typeof useSyncStore>;

const DEFAULT_SYNC_STATE = {
  provider: ProviderType.WebDAV,
  useProxy: true,
  proxyUrl: corsPath(ApiPath.Cors),

  webdav: {
    endpoint: "",
    username: "",
    password: "",
  },

  upstash: {
    forceSync: false,
    endpoint: "",
    username: STORAGE_KEY,
    apiKey: "",
  },

  lastSyncTime: 0,
  lastProvider: "",
};

export const useSyncStore = createPersistStore(
  DEFAULT_SYNC_STATE,
  (set, get) => ({
    cloudSync() {
      const config = get()[get().provider];
      return Object.values(config).every((c) => c.toString().length > 0);
    },

    markSyncTime() {
      set({ lastSyncTime: Date.now(), lastProvider: get().provider });
    },

    export() {
      const state = getLocalAppState();
      const datePart = isApp
        ? `${new Date().toLocaleDateString().replace(/\//g, "_")} ${new Date()
            .toLocaleTimeString()
            .replace(/:/g, "_")}`
        : new Date().toLocaleString();

      const fileName = `Backup-${datePart}.json`;
      downloadAs(JSON.stringify(state), fileName);
    },

    async import() {
      const rawContent = await readFromFile();
      const forceSync = get().upstash.forceSync || false;

      try {
        const remoteState = JSON.parse(rawContent) as AppState;
        const localState = getLocalAppState();
        if (forceSync) {
          setLocalAppState(remoteState);
        } else {
          mergeAppState(localState, remoteState);
          setLocalAppState(localState);
        }
        location.reload();
      } catch (e) {
        console.error("[Import]", e);
        showToast(Locale.Settings.Sync.ImportFailed);
      }
    },

    getClient() {
      const provider = get().provider;
      const client = createSyncClient(provider, get());
      return client;
    },

    async sync() {
      const localState = getLocalAppState();
      const providerConfig = get()[get().provider];
      const client = this.getClient();
      const forceSync = get().upstash.forceSync || false;
      console.log("[Upstash] Force Sync status:", forceSync);

      try {
        const remoteData = await client.get(providerConfig.username);
        const remoteState = remoteData ? JSON.parse(remoteData) : null;

        if (!remoteState || Object.keys(remoteState).length === 0) {
          console.log(
            "[Sync] Remote state is empty. Creating new sync entry:",
            providerConfig.username,
          );
          await client.set(providerConfig.username, JSON.stringify(localState));
          return;
        }

        if (!forceSync) {
          mergeAppState(localState, remoteState);
        }
        setLocalAppState(localState);
        await client.set(providerConfig.username, JSON.stringify(localState));

        this.markSyncTime();
      } catch (e) {
        console.error("[Sync] Error during synchronization: ", e);
      }
    },

    async check() {
      const client = this.getClient();
      return await client.check();
    },
  }),
  {
    name: StoreKey.Sync,
    version: 1.2,

    migrate(persistedState, version) {
      const newState = persistedState as typeof DEFAULT_SYNC_STATE;

      if (version < 1.1) {
        newState.upstash.username = STORAGE_KEY;
      }

      if (version < 1.2) {
        if (
          (persistedState as typeof DEFAULT_SYNC_STATE).proxyUrl ===
          "/api/cors/"
        ) {
          newState.proxyUrl = "";
        }
      }

      return newState as any;
    },
  },
);
