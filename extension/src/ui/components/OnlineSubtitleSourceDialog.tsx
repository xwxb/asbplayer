import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { JimakuClient, listAjattDirectoryFiles, searchAjatt } from '@/services/subtitle-sources';

interface OnlineSubtitleImportCandidate {
    name: string;
    url: string;
}

interface Props {
    open: boolean;
    onClose: () => void;
    onImport: (file: OnlineSubtitleImportCandidate) => Promise<void>;
    detectedTitleHint?: string;
}

type Source = 'jimaku' | 'ajatt';
const emptyStateText = {
    entries: 'No entries',
    directories: 'No directories',
    files: 'No files',
};

const jimakuApiKeyStorageKey = 'jimakuApiKey';

type ExtensionStorageAreaLike = {
    get: (
        keys?: string | string[] | Record<string, unknown> | null,
        callback?: (items: Record<string, unknown>) => void
    ) => Promise<Record<string, unknown>> | void;
    set: (items: Record<string, unknown>, callback?: () => void) => Promise<void> | void;
};

const getExtensionStorage = () => {
    const globalWithStorage = globalThis as typeof globalThis & {
        browser?: { storage?: { local?: chrome.storage.StorageArea } };
        chrome?: { storage?: { local?: chrome.storage.StorageArea } };
    };

    return (
        (globalWithStorage.browser?.storage?.local as ExtensionStorageAreaLike | undefined) ??
        (globalWithStorage.chrome?.storage?.local as ExtensionStorageAreaLike | undefined)
    );
};

const getChromeRuntimeLastError = () => {
    const globalWithChrome = globalThis as typeof globalThis & {
        chrome?: { runtime?: { lastError?: { message?: string } } };
    };

    return globalWithChrome.chrome?.runtime?.lastError?.message;
};

const setExtensionStorageValue = async (extensionStorage: ExtensionStorageAreaLike, key: string, value: string) => {
    if (extensionStorage.set.length >= 2) {
        await new Promise<void>((resolve, reject) => {
            extensionStorage.set({ [key]: value }, () => {
                const lastErrorMessage = getChromeRuntimeLastError();
                if (lastErrorMessage) {
                    reject(new Error(lastErrorMessage));
                    return;
                }

                resolve();
            });
        });

        return;
    }

    await extensionStorage.set({ [key]: value });
};

const getExtensionStorageValue = async (extensionStorage: ExtensionStorageAreaLike, key: string) => {
    if (extensionStorage.get.length >= 2) {
        return await new Promise<string | undefined>((resolve, reject) => {
            extensionStorage.get(key, (result) => {
                const lastErrorMessage = getChromeRuntimeLastError();
                if (lastErrorMessage) {
                    reject(new Error(lastErrorMessage));
                    return;
                }

                resolve(typeof result?.[key] === 'string' ? (result[key] as string) : undefined);
            });
        });
    }

    const result = await extensionStorage.get(key);
    if (!result) {
        return undefined;
    }

    return typeof result[key] === 'string' ? (result[key] as string) : undefined;
};

const saveJimakuApiKeyToStorage = async (apiKey: string) => {
    const extensionStorage = getExtensionStorage();

    if (extensionStorage) {
        try {
            await setExtensionStorageValue(extensionStorage, jimakuApiKeyStorageKey, apiKey);
        } catch {
            // Ignore extension storage failures and fall back to localStorage.
        }
    }

    try {
        window.localStorage.setItem(jimakuApiKeyStorageKey, apiKey);
    } catch {
        // Ignore environments that disallow storage access.
    }
};

const loadJimakuApiKeyFromStorage = async () => {
    const extensionStorage = getExtensionStorage();

    if (extensionStorage) {
        try {
            const value = await getExtensionStorageValue(extensionStorage, jimakuApiKeyStorageKey);
            if (value !== undefined) {
                return value;
            }
        } catch {
            // Ignore extension storage failures and fall back to localStorage.
        }
    }

    try {
        return window.localStorage.getItem(jimakuApiKeyStorageKey) ?? '';
    } catch {
        return '';
    }
};

const normalizeDetectedTitleHint = (hint?: string) => {
    const trimmedHint = hint?.trim() ?? '';

    if (trimmedHint.length === 0) {
        return '';
    }

    const suffixSplit = trimmedHint.split(' - ');
    if (suffixSplit.length > 1) {
        return suffixSplit[0].trim();
    }

    return trimmedHint;
};

export default function OnlineSubtitleSourceDialog({ open, onClose, onImport, detectedTitleHint }: Props) {
    const { t } = useTranslation();
    const [source, setSource] = useState<Source>('jimaku');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>();

    const [jimakuApiKey, setJimakuApiKey] = useState('');
    const [query, setQuery] = useState('');
    const [didLoadJimakuApiKey, setDidLoadJimakuApiKey] = useState(false);
    const [jimakuEntries, setJimakuEntries] = useState<{ id: number; name: string }[]>([]);
    const [jimakuSelectedEntryId, setJimakuSelectedEntryId] = useState<number>();
    const [jimakuFiles, setJimakuFiles] = useState<OnlineSubtitleImportCandidate[]>([]);

    const [ajattEntries, setAjattEntries] = useState<{ path: string; name: string }[]>([]);
    const [ajattSelectedPath, setAjattSelectedPath] = useState<string>();
    const [ajattFiles, setAjattFiles] = useState<OnlineSubtitleImportCandidate[]>([]);

    const selectedFiles = useMemo(
        () => (source === 'jimaku' ? jimakuFiles : ajattFiles),
        [source, jimakuFiles, ajattFiles]
    );
    const normalizedDetectedTitleHint = useMemo(
        () => normalizeDetectedTitleHint(detectedTitleHint),
        [detectedTitleHint]
    );
    const showDetectedTitleHint =
        normalizedDetectedTitleHint.length > 0 &&
        normalizedDetectedTitleHint.toLowerCase() !== query.trim().toLowerCase();
    const isSearchDisabled =
        loading || query.trim().length === 0 || (source === 'jimaku' && jimakuApiKey.trim().length === 0);

    const loadJimakuApiKey = useCallback(async () => {
        setJimakuApiKey(await loadJimakuApiKeyFromStorage());
        setDidLoadJimakuApiKey(true);
    }, []);

    const resetState = useCallback(() => {
        setLoading(false);
        setError(undefined);
        setJimakuEntries([]);
        setJimakuSelectedEntryId(undefined);
        setJimakuFiles([]);
        setAjattEntries([]);
        setAjattSelectedPath(undefined);
        setAjattFiles([]);
    }, []);

    const handleDialogEntered = useCallback(async () => {
        await loadJimakuApiKey();
        resetState();
    }, [loadJimakuApiKey, resetState]);

    const handleSearchJimaku = useCallback(async () => {
        setError(undefined);
        setLoading(true);

        try {
            const client = new JimakuClient({ apiKey: jimakuApiKey });
            const entries = (await client.searchEntries(query)).data;
            setJimakuEntries(entries.map((entry) => ({ id: entry.id, name: entry.name })));
            setJimakuSelectedEntryId(undefined);
            setJimakuFiles([]);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, [jimakuApiKey, query]);

    const handleLoadJimakuFiles = useCallback(
        async (entryId: number) => {
            setError(undefined);
            setLoading(true);
            setJimakuSelectedEntryId(entryId);

            try {
                const client = new JimakuClient({ apiKey: jimakuApiKey });
                const files = (await client.getFiles(entryId)).data.map((file) => ({ name: file.name, url: file.url }));
                setJimakuFiles(files);
            } catch (e) {
                setError((e as Error).message);
                setJimakuFiles([]);
            } finally {
                setLoading(false);
            }
        },
        [jimakuApiKey]
    );

    const handleSearchAjatt = useCallback(async () => {
        setError(undefined);
        setLoading(true);

        try {
            const entries = await searchAjatt(query);
            setAjattEntries(entries.map((entry) => ({ path: entry.path, name: entry.name })));
            setAjattSelectedPath(undefined);
            setAjattFiles([]);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, [query]);

    const handleLoadAjattFiles = useCallback(async (path: string) => {
        setError(undefined);
        setLoading(true);
        setAjattSelectedPath(path);

        try {
            const files = await listAjattDirectoryFiles(path);
            setAjattFiles(files);
        } catch (e) {
            setError((e as Error).message);
            setAjattFiles([]);
        } finally {
            setLoading(false);
        }
    }, []);

    const handleImport = useCallback(
        async (file: OnlineSubtitleImportCandidate) => {
            setError(undefined);
            setLoading(true);

            try {
                await onImport(file);
                onClose();
            } catch (e) {
                setError((e as Error).message);
            } finally {
                setLoading(false);
            }
        },
        [onClose, onImport]
    );

    const handleApplyDetectedTitleHint = useCallback(() => {
        setQuery(normalizedDetectedTitleHint);
    }, [normalizedDetectedTitleHint]);

    const handleSearch = useCallback(async () => {
        if (source === 'jimaku') {
            await handleSearchJimaku();
            return;
        }

        await handleSearchAjatt();
    }, [handleSearchAjatt, handleSearchJimaku, source]);

    useEffect(() => {
        if (!open || !didLoadJimakuApiKey) {
            return;
        }

        void saveJimakuApiKeyToStorage(jimakuApiKey);
    }, [didLoadJimakuApiKey, jimakuApiKey, open]);

    return (
        <Dialog
            open={open}
            onClose={onClose}
            fullWidth
            maxWidth="md"
            TransitionProps={{ onEntered: handleDialogEntered }}
        >
            <DialogTitle>
                {t('extension.videoDataSync.onlineSubtitleSources', { defaultValue: 'Online subtitle sources' })}
            </DialogTitle>
            <DialogContent>
                <Stack spacing={2}>
                    <Tabs value={source} onChange={(_, value: Source) => setSource(value)}>
                        <Tab value="jimaku" label="jimaku.cc" />
                        <Tab value="ajatt" label="subtitles.ajatt.top" />
                    </Tabs>
                    {error && <Alert severity="error">{error}</Alert>}

                    {showDetectedTitleHint && (
                        <Alert
                            severity="info"
                            action={
                                <Button onClick={handleApplyDetectedTitleHint} size="small">
                                    {t('extension.videoDataSync.fillDetectedTitle', {
                                        defaultValue: 'Use title',
                                    })}
                                </Button>
                            }
                        >
                            {t('extension.videoDataSync.detectedTitleHint', {
                                defaultValue: 'Detected from current page: {{title}}',
                                title: normalizedDetectedTitleHint,
                            })}
                        </Alert>
                    )}

                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <TextField
                            label={t('extension.videoDataSync.animeTitle', { defaultValue: 'Anime title' })}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            fullWidth
                        />
                        <Button variant="contained" onClick={handleSearch} disabled={isSearchDisabled}>
                            {t('extension.videoDataSync.search', { defaultValue: 'Search' })}
                        </Button>
                    </Box>

                    {source === 'jimaku' && (
                        <Stack spacing={2}>
                            <TextField
                                label={t('extension.videoDataSync.jimakuApiKey', { defaultValue: 'Jimaku API Key' })}
                                value={jimakuApiKey}
                                onChange={(e) => setJimakuApiKey(e.target.value)}
                                helperText={t('extension.videoDataSync.jimakuApiKeyAutosaveHint', {
                                    defaultValue: 'Only used for jimaku.cc. Saved automatically after typing.',
                                })}
                                fullWidth
                            />
                            <Typography variant="subtitle2">
                                {t('extension.videoDataSync.entries', { defaultValue: 'Entries' })}
                            </Typography>
                            <List
                                dense
                                sx={{ maxHeight: 180, overflow: 'auto', border: '1px solid', borderColor: 'divider' }}
                            >
                                {jimakuEntries.map((entry) => (
                                    <ListItemButton
                                        key={entry.id}
                                        onClick={() => handleLoadJimakuFiles(entry.id)}
                                        selected={jimakuSelectedEntryId === entry.id}
                                    >
                                        <ListItemText primary={entry.name} />
                                    </ListItemButton>
                                ))}
                                {jimakuEntries.length === 0 && (
                                    <ListItem>
                                        <ListItemText
                                            primary={t('extension.videoDataSync.noEntries', {
                                                defaultValue: emptyStateText.entries,
                                            })}
                                        />
                                    </ListItem>
                                )}
                            </List>
                        </Stack>
                    )}

                    {source === 'ajatt' && (
                        <Stack spacing={2}>
                            <Typography variant="subtitle2">
                                {t('extension.videoDataSync.directories', { defaultValue: 'Directories' })}
                            </Typography>
                            <List
                                dense
                                sx={{ maxHeight: 180, overflow: 'auto', border: '1px solid', borderColor: 'divider' }}
                            >
                                {ajattEntries.map((entry) => (
                                    <ListItemButton
                                        key={entry.path}
                                        onClick={() => handleLoadAjattFiles(entry.path)}
                                        selected={ajattSelectedPath === entry.path}
                                    >
                                        <ListItemText primary={entry.name} />
                                    </ListItemButton>
                                ))}
                                {ajattEntries.length === 0 && (
                                    <ListItem>
                                        <ListItemText
                                            primary={t('extension.videoDataSync.noDirectories', {
                                                defaultValue: emptyStateText.directories,
                                            })}
                                        />
                                    </ListItem>
                                )}
                            </List>
                        </Stack>
                    )}

                    <Typography variant="subtitle2">
                        {t('extension.videoDataSync.availableFiles', { defaultValue: 'Available files' })}
                    </Typography>
                    <List dense sx={{ maxHeight: 220, overflow: 'auto', border: '1px solid', borderColor: 'divider' }}>
                        {selectedFiles.map((file) => (
                            <ListItemButton key={file.url} onClick={() => handleImport(file)}>
                                <ListItemText primary={file.name} secondary={file.url} />
                            </ListItemButton>
                        ))}
                        {selectedFiles.length === 0 && (
                            <ListItem>
                                <ListItemText
                                    primary={t('extension.videoDataSync.noFiles', { defaultValue: emptyStateText.files })}
                                />
                            </ListItem>
                        )}
                    </List>
                    {loading && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
                            <CircularProgress size={22} />
                        </Box>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{t('action.cancel')}</Button>
            </DialogActions>
        </Dialog>
    );
}
