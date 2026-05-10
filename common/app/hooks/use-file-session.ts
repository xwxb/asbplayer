import { useCallback, useEffect, useState } from 'react';
import {
    IndexedDBFileSessionRepository,
    isMediaExtension,
    isSubtitleExtension,
    supportsFileSystemAccess,
} from '../../file-system-access';

let _repository: IndexedDBFileSessionRepository | undefined;
const getRepository = () => {
    if (_repository === undefined && supportsFileSystemAccess()) {
        _repository = new IndexedDBFileSessionRepository();
    }
    return _repository;
};

export const useFileSession = () => {
    const fileSessionRepository = getRepository();
    const [canRestoreLastSession, setCanRestoreLastSession] = useState<boolean>(false);

    useEffect(() => {
        if (!fileSessionRepository) return;
        fileSessionRepository.fetch().then((record) => {
            if (record && (record.videoHandle || record.subtitleHandles.length > 0)) {
                setCanRestoreLastSession(true);
            }
        });
    }, []);

    const saveSession = useCallback(async (handles: FileSystemFileHandle[]) => {
        if (!fileSessionRepository) return;
        let videoHandle: FileSystemFileHandle | undefined;
        const subtitleHandles: FileSystemFileHandle[] = [];
        const unknownHandles: FileSystemFileHandle[] = [];
        for (const h of handles) {
            if (isMediaExtension(h.name)) {
                videoHandle = h;
            } else if (isSubtitleExtension(h.name)) {
                subtitleHandles.push(h);
            } else {
                unknownHandles.push(h);
            }
        }

        if (unknownHandles.length > 0) {
            console.warn(
                'Ignoring unsupported handles for file session restore',
                unknownHandles.map((h) => h.name)
            );
        }

        if (!videoHandle && subtitleHandles.length === 0) {
            return;
        }

        await fileSessionRepository.merge({ videoHandle, subtitleHandles });
        setCanRestoreLastSession(true);
    }, []);

    const fetchSession = useCallback(() => fileSessionRepository?.fetch(), []);

    const clearSession = useCallback(async () => {
        await fileSessionRepository?.clear();
        setCanRestoreLastSession(false);
    }, []);

    return {
        canRestoreLastSession,
        saveSession,
        fetchSession,
        clearSession,
    };
};
