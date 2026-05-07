/**
 * File System Access API helpers (Chrome-only).
 * Provides showOpenFilePicker-based file selection that returns FileSystemFileHandle objects,
 * and utilities to re-acquire permissions and resolve handles back to File objects on revisit.
 */

export function supportsFileSystemAccess(): boolean {
    return typeof window !== 'undefined' && 'showOpenFilePicker' in window;
}

export async function requestPermissions(
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
            // queryPermission not supported, fall through to requestPermission
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

export async function resolveFiles(
    handles: FileSystemFileHandle[]
): Promise<{ files: File[]; errors: FileSystemFileHandle[] }> {
    const files: File[] = [];
    const errors: FileSystemFileHandle[] = [];

    for (const handle of handles) {
        try {
            files.push(await handle.getFile());
        } catch {
            errors.push(handle);
        }
    }

    return { files, errors };
}

const videoExtensions = ['.mkv', '.mp4', '.m4v', '.avi', '.webm'];
const audioExtensions = ['.mp3', '.m4a', '.aac', '.flac', '.ogg', '.wav', '.opus', '.m4b'];
const subtitleExtensions = ['.srt', '.ass', '.vtt', '.sup', '.nfvtt', '.ytxml', '.ytsrv3', '.dfxp', '.ttml2', '.bbjson'];

export async function showFilePicker(): Promise<FileSystemFileHandle[] | undefined> {
    if (!supportsFileSystemAccess()) {
        return undefined;
    }

    try {
        const handles = await (window as any).showOpenFilePicker({
            multiple: true,
            types: [
                {
                    description: 'Media files',
                    accept: {
                        'video/*': videoExtensions,
                        'audio/*': audioExtensions,
                    },
                },
                {
                    description: 'Subtitle files',
                    accept: { 'text/*': subtitleExtensions },
                },
            ],
        });
        return handles as FileSystemFileHandle[];
    } catch (e: any) {
        if (e.name === 'AbortError') {
            return undefined;
        }
        throw e;
    }
}
