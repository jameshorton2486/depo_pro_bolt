// ============================================================================
// localStore.ts
// ----------------------------------------------------------------------------
// Tiny IndexedDB wrapper that replaces Supabase for local-first storage.
// Stores transcription jobs and their utterances so you can close the tab
// and come back to them.
//
// Why IndexedDB (and not localStorage)?
//   - localStorage maxes out at ~5 MB per origin. A single transcript with
//     1,000 utterances easily exceeds that.
//   - IndexedDB handles hundreds of MB without breaking a sweat.
//
// Why a custom wrapper (and not idb-keyval or Dexie)?
//   - One less dependency to install. The wrapper is ~80 lines and does
//     everything this app needs.
// ============================================================================

import type { ParsedUtterance } from './deepgramClient';

const DB_NAME = 'depopro_local';
const DB_VERSION = 1;
const STORE_JOBS = 'jobs';
const STORE_UTTERANCES = 'utterances';

export interface StoredJob {
  id: string;
  created_at: string;        // ISO timestamp
  source_file_name: string;
  source_file_size: number;
  compressed_size: number;
  duration_sec: number;
  status: 'processing' | 'complete' | 'failed';
  phase: string;
  error_message?: string;
  word_count: number;
  speaker_count: number;
  // Case metadata snapshot
  case_data?: Record<string, unknown>;
  // Deepgram options used
  deepgram_options?: Record<string, unknown>;
  // Speaker name mapping: speaker_id (0,1,2…) → mapped name
  speaker_names: Record<number, string>;
  // Final Deepgram request ID for audit
  deepgram_request_id?: string;
}

// ----------------------------------------------------------------------------
// Open (and migrate) the database
// ----------------------------------------------------------------------------
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_JOBS)) {
        const jobs = db.createObjectStore(STORE_JOBS, { keyPath: 'id' });
        jobs.createIndex('created_at', 'created_at');
      }
      if (!db.objectStoreNames.contains(STORE_UTTERANCES)) {
        const utts = db.createObjectStore(STORE_UTTERANCES, {
          keyPath: ['job_id', 'sequence_index'],
        });
        utts.createIndex('job_id', 'job_id');
      }
    };
  });
}

// ----------------------------------------------------------------------------
// Generic helpers
// ----------------------------------------------------------------------------
async function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req = op(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ----------------------------------------------------------------------------
// Jobs
// ----------------------------------------------------------------------------
export async function saveJob(job: StoredJob): Promise<void> {
  await run(STORE_JOBS, 'readwrite', store => store.put(job));
}

export async function getJob(id: string): Promise<StoredJob | undefined> {
  return await run(STORE_JOBS, 'readonly', store => store.get(id));
}

export async function listJobs(): Promise<StoredJob[]> {
  const all = await run<StoredJob[]>(STORE_JOBS, 'readonly', store => store.getAll());
  // Newest first
  return all.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function deleteJob(id: string): Promise<void> {
  // Delete the job row
  await run(STORE_JOBS, 'readwrite', store => store.delete(id));
  // And all its utterances
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_UTTERANCES, 'readwrite');
    const store = tx.objectStore(STORE_UTTERANCES);
    const index = store.index('job_id');
    const req = index.openCursor(IDBKeyRange.only(id));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error);
  });
}

// ----------------------------------------------------------------------------
// Utterances
// ----------------------------------------------------------------------------
interface StoredUtterance extends ParsedUtterance {
  job_id: string;
  corrected_transcript?: string;
  edited?: boolean;
}

export async function saveUtterances(
  jobId: string,
  utterances: ParsedUtterance[],
): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_UTTERANCES, 'readwrite');
    const store = tx.objectStore(STORE_UTTERANCES);
    for (const u of utterances) {
      store.put({ ...u, job_id: jobId } as StoredUtterance);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getUtterances(jobId: string): Promise<StoredUtterance[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_UTTERANCES, 'readonly');
    const store = tx.objectStore(STORE_UTTERANCES);
    const index = store.index('job_id');
    const req = index.getAll(IDBKeyRange.only(jobId));
    req.onsuccess = () => {
      const sorted = (req.result as StoredUtterance[]).sort(
        (a, b) => a.sequence_index - b.sequence_index,
      );
      resolve(sorted);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function updateUtterance(
  jobId: string,
  sequenceIndex: number,
  updates: Partial<StoredUtterance>,
): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_UTTERANCES, 'readwrite');
    const store = tx.objectStore(STORE_UTTERANCES);
    const getReq = store.get([jobId, sequenceIndex]);
    getReq.onsuccess = () => {
      const existing = getReq.result as StoredUtterance | undefined;
      if (!existing) {
        reject(new Error(`Utterance ${jobId}/${sequenceIndex} not found`));
        return;
      }
      const updated = { ...existing, ...updates, edited: true };
      const putReq = store.put(updated);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export type { StoredUtterance };
