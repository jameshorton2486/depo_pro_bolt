// ============================================================================
// intakeStore.ts — IndexedDB persistence for case intake records
// ============================================================================

import type { IntakeRecord } from '../types/intake';

const DB_NAME = 'depopro_local';
const DB_VERSION = 2; // bumped from v1 to add intake store
const STORE_INTAKE = 'intake_records';

// ────────────────────────────────────────────────────────────────────────────
// DB open / upgrade
// ────────────────────────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = event => {
      const db = req.result;
      const oldVersion = event.oldVersion;

      // v1 stores (created by localStore.ts) — leave untouched
      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains('jobs')) {
          const jobs = db.createObjectStore('jobs', { keyPath: 'id' });
          jobs.createIndex('created_at', 'created_at');
        }
        if (!db.objectStoreNames.contains('utterances')) {
          const utts = db.createObjectStore('utterances', {
            keyPath: ['job_id', 'sequence_index'],
          });
          utts.createIndex('job_id', 'job_id');
        }
      }

      // v2 — add intake_records store
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(STORE_INTAKE)) {
          const intake = db.createObjectStore(STORE_INTAKE, { keyPath: 'id' });
          intake.createIndex('createdAt', 'createdAt');
          intake.createIndex('updatedAt', 'updatedAt');
        }
      }
    };
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Generic helpers
// ────────────────────────────────────────────────────────────────────────────

async function run<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_INTAKE, mode);
    const store = tx.objectStore(STORE_INTAKE);
    const req = op(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export async function saveIntake(record: IntakeRecord): Promise<void> {
  const now = new Date().toISOString();
  await run('readwrite', store =>
    store.put({ ...record, updatedAt: now }),
  );
}

export async function getIntake(id: string): Promise<IntakeRecord | undefined> {
  return await run('readonly', store => store.get(id));
}

export async function listIntakes(): Promise<IntakeRecord[]> {
  const all = await run<IntakeRecord[]>('readonly', store => store.getAll());
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteIntake(id: string): Promise<void> {
  await run('readwrite', store => store.delete(id));
}

export function createEmptyIntake(overrides: Partial<IntakeRecord> = {}): IntakeRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    caseInfo: {
      causeNumber: '',
      caseStyle: '',
      plaintiff: '',
      defendant: '',
      courtType: '',
      court: '',
      district: '',
      division: '',
      county: '',
      state: 'Texas',
    },
    depositionDetails: {
      deponent: { name: '', role: 'Witness' },
      date: '',
      time: '',
      location: '',
      method: '',
      isZoom: false,
      noticeTitle: '',
    },
    appearances: [],
    reporterJobDetails: {},
    billing: {},
    deepgramKeyterms: [],
    confirmedSpellings: [],
    phoneticMappings: [],
    ...overrides,
  };
}
