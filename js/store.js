/* ---------- almacenamiento local (IndexedDB) ----------
   Base "rastro" con tres almacenes:
   - projects: { id, name, createdAt, updatedAt, dur, clipsN, thumb, data }
   - media:    { id, blob, name, type, size }   ← los videos importados
   - meta:     { k, v }                          ← p. ej. último proyecto abierto
   Todo vive en el navegador del usuario; nada sale del dispositivo.
*/
const DB_NAME = 'rastro',
  DB_VER = 1;
let dbp = null;

export function openDB() {
  if (!dbp)
    dbp = new Promise((res, rej) => {
      if (!('indexedDB' in window)) return rej(new Error('Este navegador no tiene IndexedDB'));
      let r;
      try {
        r = indexedDB.open(DB_NAME, DB_VER);
      } catch (e) {
        return rej(e);
      }
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('media')) d.createObjectStore('media', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'k' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('La base de datos está bloqueada por otra pestaña'));
    });
  return dbp;
}

function run(store, mode, fn) {
  return openDB().then(
    d =>
      new Promise((res, rej) => {
        const t = d.transaction(store, mode),
          s = t.objectStore(store);
        let out;
        const r = fn(s);
        if (r)
          r.onsuccess = () => {
            out = r.result;
          };
        t.oncomplete = () => res(out);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error || new Error('Transacción cancelada'));
      })
  );
}

export const dbGet = (store, key) => run(store, 'readonly', s => s.get(key));
export const dbAll = store => run(store, 'readonly', s => s.getAll());
export const dbKeys = store => run(store, 'readonly', s => s.getAllKeys());
export const dbPut = (store, val) => run(store, 'readwrite', s => s.put(val));
export const dbDel = (store, key) => run(store, 'readwrite', s => s.delete(key));

export const getMeta = k => dbGet('meta', k).then(r => (r ? r.v : undefined));
export const setMeta = (k, v) => dbPut('meta', { k, v });

/** ¿Es un error de espacio agotado? */
export const isQuota = e => !!e && (e.name === 'QuotaExceededError' || e.code === 22 || /quota/i.test(e.message || ''));

/** Pide al navegador no borrar los datos bajo presión de espacio (puede negarse). */
export async function askPersist() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted()))
      await navigator.storage.persist();
  } catch (e) {}
}

export async function estimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
  } catch (e) {}
  return null;
}
