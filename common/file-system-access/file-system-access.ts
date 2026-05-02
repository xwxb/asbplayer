export function supportsFileSystemAccess(): boolean {
    return typeof window !== 'undefined' && 'showOpenFilePicker' in window;
}

export async function requestFileHandlePermissions(
    handles: FileSystemFileHandle[]
): Promise<{ granted: FileSystemFileHandle[]; denied: FileSystemFileHandle[] }> {
    const granted: FileSystemFileHandle[] = [];
    const denied: FileSystemFileHandle[] = [];

    for (const handle of handles) {
        try {
            const state = await (handle as any).queryPermission?.({ mode: 'read' });
            if (state === 'granted') {
                granted.push(handle);
                continue;
            }
        } catch {
            // ignore
        }

        try {
            const state = await (handle as any).requestPermission?.({ mode: 'read' });
            if (state === 'granted') {
                granted.push(handle);
            } else {
                denied.push(handle);
            }
        } catch {
            denied.push(handle);
        }
    }

    return { granted, denied };
}

export async function resolveFilesFromHandles(
    handles: FileSystemFileHandle[]
): Promise<{ files: File[]; errors: FileSystemFileHandle[] }> {
    const files: File[] = [];
    const errors: FileSystemFileHandle[] = [];

    for (const handle of handles) {
        try {
            const file = await handle.getFile();
            files.push(file);
        } catch {
            errors.push(handle);
        }
    }

    return { files, errors };
}

export interface FilePickerOptions {
    video?: boolean;
    subtitles?: boolean;
    multiple?: boolean;
}

export async function showFilePicker(options: FilePickerOptions = {}): Promise<FileSystemFileHandle[] | undefined> {
    if (!supportsFileSystemAccess()) {
        return undefined;
    }

    const types: FilePickerAcceptType[] = [];

    if (options.video !== false) {
        types.push({
            description: 'Media files',
            accept: {
                'video/*': ['.mkv', '.mp4', '.m4v', '.avi', '.webm'],
                'audio/*': ['.mp3', '.m4a', '.aac', '.flac', '.ogg', '.wav', '.opus', '.m4b'],
            },
        });
    }

    if (options.subtitles !== false) {
        types.push({
            description: 'Subtitle files',
            accept: {
                'text/*': ['.srt', '.ass', '.vtt', '.sup', '.nfvtt', '.ytxml', '.ytsrv3', '.dfxp', '.ttml2', '.bbjson'],
            },
        });
    }

    try {
        const handles = await (window as any).showOpenFilePicker({
            multiple: options.multiple ?? true,
            types,
        });
        return handles as FileSystemFileHandle[];
    } catch (e: any) {
        if (e.name === 'AbortError') {
            return undefined;
        }
        throw e;
    }
}
