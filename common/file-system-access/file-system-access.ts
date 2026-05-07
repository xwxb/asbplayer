/**
 * File System Access API helpers (Chrome-only).
 * Provides showOpenFilePicker-based file selection that returns FileSystemFileHandle objects,
 * and utilities to re-acquire permissions and resolve handles back to File objects on revisit.
 */

const videoExtensions = ['.mkv', '.mp4', '.m4v', '.avi', '.webm'] as const;
const audioExtensions = ['.mp3', '.m4a', '.aac', '.flac', '.ogg', '.wav', '.opus', '.m4b'] as const;
const mediaExtensions = new Set<string>([...videoExtensions, ...audioExtensions]);
const subtitleExtensions = new Set([
    '.srt', '.ass', '.vtt', '.sup', '.nfvtt', '.ytxml', '.ytsrv3', '.dfxp', '.ttml2', '.bbjson',
]);

function extOf(name: string): string {
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.substring(i).toLowerCase() : '';
}

export function isMediaExtension(name: string): boolean {
    return mediaExtensions.has(extOf(name));
}

export function isSubtitleExtension(name: string): boolean {
    return subtitleExtensions.has(extOf(name));
}

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

export async function showFilePicker(): Promise<FileSystemFileHandle[] | undefined> {
    if (!supportsFileSystemAccess()) {
        return undefined;
    }

    try {
        const handles = await (window as any).showOpenFilePicker({
            multiple: true,
            types: [
                {
                    description: 'Media and subtitle files',
                    accept: {
                        'video/*': [...videoExtensions],
                        'audio/*': [...audioExtensions],
                        'text/*': [...subtitleExtensions],
                    },
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
