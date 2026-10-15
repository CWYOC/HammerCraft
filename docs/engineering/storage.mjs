// IndexedDB keeps larger numerical results out of localStorage's small quota.
export async function openProjectStore() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("hc-engineering-studio", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("documents");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(
        Error("Close other Engineering Studio tabs to update local storage."),
      );
  });
  function transaction(mode, operation) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("documents", mode),
        store = tx.objectStore("documents");
      let result;
      operation(store, (value) => {
        result = value;
      });
      tx.oncomplete = () => resolve(result);
      tx.onerror = () =>
        reject(tx.error || Error("Local project storage failed."));
      tx.onabort = () =>
        reject(tx.error || Error("Local project storage was aborted."));
    });
  }
  return {
    read: (key) =>
      transaction("readonly", (store, done) => {
        const r = store.get(key);
        r.onsuccess = () => done(r.result);
      }),
    save: (project) =>
      transaction("readwrite", (store) => {
        const previous = store.get("active");
        previous.onsuccess = () => {
          // Re-exporting an unchanged project must not erase its recovery point.
          if (JSON.stringify(previous.result) === JSON.stringify(project))
            return;
          if (previous.result) store.put(previous.result, "recovery");
          store.put(project, "active");
        };
      }),
  };
}
