import Dexie from 'dexie';

export interface FileSessionRecord {
    id: number;
    videoHandle?: FileSystemFileHandle;
    subtitleHandles: FileSystemFileHandle[];
    timestamp: number;
}

class FileSessionDatabase extends Dexie {
    sessions!: Dexie.Table<FileSessionRecord, number>;

    constructor() {
        super('FileSessionDatabase');
        this.version(1).stores({
            sessions: '++id,timestamp',
        });
    }
}

export interface FileSessionRepository {
    fetch: () => Promise<FileSessionRecord | undefined>;
    save: (record: Omit<FileSessionRecord, 'id' | 'timestamp'>) => Promise<void>;
    clear: () => Promise<void>;
}

export class IndexedDBFileSessionRepository implements FileSessionRepository {
    private readonly _db = new FileSessionDatabase();

    async fetch(): Promise<FileSessionRecord | undefined> {
        const records = await this._db.sessions.orderBy('timestamp').reverse().limit(1).toArray();
        return records.length > 0 ? records[0] : undefined;
    }

    async save(record: Omit<FileSessionRecord, 'id' | 'timestamp'>): Promise<void> {
        await this._db.sessions.clear();
        await this._db.sessions.add({
            ...record,
            id: 1,
            timestamp: Date.now(),
        });
    }

    async clear(): Promise<void> {
        await this._db.sessions.clear();
    }
}
