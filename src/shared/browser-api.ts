type AnyApi = Record<string, any>;

export function extensionApi(): AnyApi {
  const globalScope = globalThis as AnyApi;
  const api = globalScope.browser ?? globalScope.chrome;
  if (!api) {
    throw new Error("Browser extension API is not available.");
  }
  return api;
}

export function usesPromiseApi(): boolean {
  return Boolean((globalThis as AnyApi).browser);
}

export function getRuntimeError(): Error | undefined {
  const error = extensionApi().runtime?.lastError;
  return error ? new Error(error.message) : undefined;
}

export function storageGet<T extends Record<string, unknown>>(defaults: T): Promise<T> {
  const api = extensionApi();
  if (usesPromiseApi()) {
    return api.storage.local.get(defaults) as Promise<T>;
  }

  return new Promise<T>((resolve, reject) => {
    api.storage.local.get(defaults, (items: T) => {
      const error = getRuntimeError();
      if (error) {
        reject(error);
        return;
      }
      resolve(items);
    });
  });
}

export function storageSet(values: Record<string, unknown>): Promise<void> {
  const api = extensionApi();
  if (usesPromiseApi()) {
    return api.storage.local.set(values) as Promise<void>;
  }

  return new Promise<void>((resolve, reject) => {
    api.storage.local.set(values, () => {
      const error = getRuntimeError();
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function runtimeSendMessage<T>(message: unknown): Promise<T> {
  const api = extensionApi();
  if (usesPromiseApi()) {
    return api.runtime.sendMessage(message) as Promise<T>;
  }

  return new Promise<T>((resolve, reject) => {
    api.runtime.sendMessage(message, (response: T) => {
      const error = getRuntimeError();
      if (error) {
        reject(error);
        return;
      }
      resolve(response);
    });
  });
}

export function tabsQuery(queryInfo: Record<string, unknown>): Promise<any[]> {
  const api = extensionApi();
  if (usesPromiseApi()) {
    return api.tabs.query(queryInfo) as Promise<any[]>;
  }

  return new Promise<any[]>((resolve, reject) => {
    api.tabs.query(queryInfo, (tabs: any[]) => {
      const error = getRuntimeError();
      if (error) {
        reject(error);
        return;
      }
      resolve(tabs);
    });
  });
}

export function tabsCreate(createProperties: Record<string, unknown>): Promise<any> {
  const api = extensionApi();
  if (usesPromiseApi()) {
    return api.tabs.create(createProperties) as Promise<any>;
  }

  return new Promise<any>((resolve, reject) => {
    api.tabs.create(createProperties, (tab: any) => {
      const error = getRuntimeError();
      if (error) {
        reject(error);
        return;
      }
      resolve(tab);
    });
  });
}

export function tabsSendMessage<T>(
  tabId: number,
  message: unknown,
  options?: Record<string, unknown>
): Promise<T> {
  const api = extensionApi();
  if (usesPromiseApi()) {
    return api.tabs.sendMessage(tabId, message, options) as Promise<T>;
  }

  return new Promise<T>((resolve, reject) => {
    api.tabs.sendMessage(tabId, message, options ?? {}, (response: T) => {
      const error = getRuntimeError();
      if (error) {
        reject(error);
        return;
      }
      resolve(response);
    });
  });
}

