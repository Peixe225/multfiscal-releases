/**
 * Tiny key-value persistence: IndexedDB (db "lenda", store "kv"), falling back to localStorage.
 * Writes are serialized per key (latest wins) so rapid saves never interleave.
 *
 *   await kv.get<CareerState>('career:current')
 *   await kv.set('hall', entries)
 *   await kv.del('career:current')
 */
const DB = 'lenda'
const STORE = 'kv'
const LS_PREFIX = 'lenda:kv:'

let dbp: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbp) return dbp
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbp
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = run(t.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    t.onabort = () => reject(t.error)
  })
}

const lsGet = <T,>(k: string): T | undefined => {
  try {
    const raw = localStorage.getItem(LS_PREFIX + k)
    return raw ? (JSON.parse(raw) as T) : undefined
  } catch {
    return undefined
  }
}
const lsSet = (k: string, v: unknown) => {
  try {
    localStorage.setItem(LS_PREFIX + k, JSON.stringify(v))
    return true
  } catch {
    return false
  }
}

const queues = new Map<string, Promise<unknown>>()
function enqueue<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve()
  const next = prev.then(job, job)
  queues.set(key, next.catch(() => {}))
  return next
}

export const kv = {
  async get<T>(key: string): Promise<T | undefined> {
    const db = await openDb()
    if (db) {
      try {
        const v = await tx<T | undefined>(db, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>)
        if (v !== undefined) return v
      } catch {
        /* fall through */
      }
    }
    return lsGet<T>(key)
  },
  set(key: string, value: unknown): Promise<boolean> {
    return enqueue(key, async () => {
      const db = await openDb()
      if (db) {
        try {
          await tx(db, 'readwrite', (s) => s.put(value, key))
          try {
            localStorage.removeItem(LS_PREFIX + key)
          } catch {
            /* ignore */
          }
          return true
        } catch (err) {
          console.warn('[LENDA] IndexedDB falhou, usando localStorage', err)
        }
      }
      return lsSet(key, value)
    })
  },
  del(key: string): Promise<void> {
    return enqueue(key, async () => {
      const db = await openDb()
      if (db) {
        try {
          await tx(db, 'readwrite', (s) => s.delete(key))
        } catch {
          /* ignore */
        }
      }
      try {
        localStorage.removeItem(LS_PREFIX + key)
      } catch {
        /* ignore */
      }
    })
  },
}

export const KV_KEYS = {
  current: 'career:current',
  hall: 'hall',
  achievements: 'achievements',
} as const
