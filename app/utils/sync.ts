import {
  ChatSession,
  useAccessStore,
  useAppConfig,
  useChatStore,
} from "../store";
import { useMaskStore } from "../store/mask";
import { usePromptStore } from "../store/prompt";
import { StoreKey } from "../constant";
import { merge } from "./merge";

type NonFunctionKeys<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? never : K;
}[keyof T];
type NonFunctionFields<T> = Pick<T, NonFunctionKeys<T>>;

export function getNonFunctionFileds<T extends object>(obj: T) {
  const ret: any = {};

  Object.entries(obj).map(([k, v]) => {
    if (typeof v !== "function") {
      ret[k] = v;
    }
  });

  return ret as NonFunctionFields<T>;
}

export type GetStoreState<T> = T extends { getState: () => infer U }
  ? NonFunctionFields<U>
  : never;

const LocalStateSetters = {
  [StoreKey.Chat]: useChatStore.setState,
  [StoreKey.Access]: useAccessStore.setState,
  [StoreKey.Config]: useAppConfig.setState,
  [StoreKey.Mask]: useMaskStore.setState,
  [StoreKey.Prompt]: usePromptStore.setState,
} as const;

const LocalStateGetters = {
  [StoreKey.Chat]: () => getNonFunctionFileds(useChatStore.getState()),
  [StoreKey.Access]: () => getNonFunctionFileds(useAccessStore.getState()),
  [StoreKey.Config]: () => getNonFunctionFileds(useAppConfig.getState()),
  [StoreKey.Mask]: () => getNonFunctionFileds(useMaskStore.getState()),
  [StoreKey.Prompt]: () => getNonFunctionFileds(usePromptStore.getState()),
} as const;

export type AppState = {
  [k in keyof typeof LocalStateGetters]: ReturnType<
    (typeof LocalStateGetters)[k]
  >;
};

type Merger<T extends keyof AppState, U = AppState[T]> = (
  primaryState: U,
  secondaryState: U,
) => U;

type StateMerger = {
  [K in keyof AppState]: Merger<K>;
};

// we merge remote state to local state
const MergeStates: StateMerger = {
  [StoreKey.Chat]: (primaryState, secondaryState) => {
    // Implement logic to merge primaryState into secondaryState

    // Add or update sessions from secondaryState
    const primarySessions: Record<string, ChatSession> = {};
    secondaryState.sessions.forEach((s) => (primarySessions[s.id] = s));

    secondaryState.sessions.forEach((secondarySession) => {
      // skip empty chats
      if (secondarySession.messages.length === 0) return;

      const primarySession = primarySessions[secondarySession.id];
      if (!primarySession) {
        // if remote session is new, just merge it
        primaryState.sessions.push(secondarySession);
      } else {
        // if both have the same session id, merge the messages
        const primaryMessageIds = new Set(
          primarySession.messages.map((v) => v.id),
        );
        secondarySession.messages.forEach((m) => {
          if (!primaryMessageIds.has(m.id)) {
            primarySession.messages.push(m);
          }
        });

        // sort local messages with date field in asc order
        primarySession.messages.sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        );
      }
    });

    // sort local sessions with date field in desc order
    primaryState.sessions.sort(
      (a, b) =>
        new Date(b.lastUpdate).getTime() - new Date(a.lastUpdate).getTime(),
    );

    return primaryState;
  },
  [StoreKey.Prompt]: (primaryState, secondaryState) => {
    primaryState.prompts = {
      ...secondaryState.prompts,
      ...primaryState.prompts,
    };
    return primaryState;
  },
  [StoreKey.Mask]: (primaryState, secondaryState) => {
    primaryState.masks = {
      ...secondaryState.masks,
      ...primaryState.masks,
    };
    return primaryState;
  },
  [StoreKey.Config]: mergeWithUpdate<AppState[StoreKey.Config]>,
  [StoreKey.Access]: mergeWithUpdate<AppState[StoreKey.Access]>,
};

export function getLocalAppState() {
  const appState = Object.fromEntries(
    Object.entries(LocalStateGetters).map(([key, getter]) => {
      return [key, getter()];
    }),
  ) as AppState;

  return appState;
}

export function setLocalAppState(appState: AppState) {
  Object.entries(LocalStateSetters).forEach(([key, setter]) => {
    setter(appState[key as keyof AppState]);
  });
}

export function mergeAppState(
  stateA: AppState,
  stateB: AppState,
  preferRemote: boolean,
) {
  // Decide which state is considered 'primary' based on preferRemote flag
  const primaryState = preferRemote ? stateB : stateA;
  const secondaryState = preferRemote ? stateA : stateB;

  // Proceed with merging if local state is not empty

  Object.keys(primaryState).forEach(<T extends keyof AppState>(k: string) => {
    const key = k as T;
    const primaryStoreState = primaryState[key];
    const secondaryStoreState = secondaryState[key];
    MergeStates[key](primaryStoreState, secondaryStoreState);
  });
  // Now, secondaryState contains the merged state
  return primaryState;
}

/**
 * Merge state with `lastUpdateTime`, older state will be overridden
 */
export function mergeWithUpdate<T extends { lastUpdateTime?: number }>(
  primaryState: T,
  secondaryState: T,
) {
  const primaryUpdateTime = primaryState.lastUpdateTime ?? 0;
  const secondaryUpdateTime = secondaryState.lastUpdateTime ?? 1;

  if (primaryUpdateTime < secondaryUpdateTime) {
    merge(secondaryState, primaryState);
    return { ...secondaryState };
  } else {
    merge(primaryState, secondaryState);
    return { ...primaryState };
  }
}
