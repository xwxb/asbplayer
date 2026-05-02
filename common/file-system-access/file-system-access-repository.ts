import Dexie from 'dexie';

export interface FileSystemAccessRecord {
    id: number;
    videoHandle?: FileSystemFileHandle;
    subtitleHandles: FileSystemFileHandle[];
    timestamp: number;
}

class FileSystemAccessDatabase extends Dexie {
    fileSystemAccessItems!: Dexie.Table<FileSystemAccessRecord, number>;

    constructor() {
        super('FileSystemAccessDatabase');
        this.version(1).stores({
            fileSystemAccessItems: '++id,timestamp',
        });
    }
}

export interface FileSystemAccessRepository {
    fetch: () => Promise<FileSystemAccessRecord | undefined>;
    save: (record: Omit<FileSystemAccessRecord, 'id' | 'timestamp'>) => Promise<void>;
    clear: () => Promise<void>;
}

export class IndexedDBFileSystemAccessRepository implements FileSystemAccessRepository {
    private readonly _db = new FileSystemAccessDatabase();

    async fetch(): Promise<FileSystemAccessRecord | undefined> {
        const records = await this._db.fileSystemAccessItems.reverse().limit(1).toArray();
        return records.length > 0 ? records[0] : undefined;
    }

    async save(record: { videoHandle?: FileSystemFileHandle; subtitleHandles: FileSystemFileHandle[] }): Promise<void> {
        await this._db.fileSystemAccessItems.clear();
        const toAdd: FileSystemAccessRecord = {
            id: 1,
            videoHandle: record.videoHandle,
            subtitleHandles: record.subtitleHandles,
            timestamp: Date.now(),
        };
        await this._db.fileSystemAccessItems.add(toAdd);
    }

    async clear(): Promise<void> {
        await this._db.fileSystemAccessItems.clear();
    }
}
