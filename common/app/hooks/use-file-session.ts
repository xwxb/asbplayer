import { useCallback, useEffect, useState } from 'react';
import {
    IndexedDBFileSessionRepository,
    isMediaExtension,
    isSubtitleExtension,
    supportsFileSystemAccess,
} from '../../file-system-access';

export const useFileSession = () => {
    const [fileSessionRepository] = useState<IndexedDBFileSessionRepository | undefined>(() =>
        supportsFileSystemAccess() ? new IndexedDBFileSessionRepository() : undefined
    );
    const [canRestoreLastSession, setCanRestoreLastSession] = useState<boolean>(false);

    useEffect(() => {
        if (!fileSessionRepository) return;
        fileSessionRepository.fetch().then((record) => {
            if (record && (record.videoHandle || record.subtitleHandles.length > 0)) {
                setCanRestoreLastSession(true);
            }
        });
    }, [fileSessionRepository]);

    const saveSession = useCallback(
        async (handles: FileSystemFileHandle[]) => {
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
        },
        [fileSessionRepository]
    );

    const fetchSession = useCallback(() => fileSessionRepository?.fetch(), [fileSessionRepository]);

    const clearSession = useCallback(async () => {
        await fileSessionRepository?.clear();
        setCanRestoreLastSession(false);
    }, [fileSessionRepository]);

    return {
        canRestoreLastSession,
        saveSession,
        fetchSession,
        clearSession,
    };
};
