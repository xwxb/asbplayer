export interface JimakuEntry {
    id: number;
    anilist_id?: number;
    name: string;
    japanese_name?: string;
    english_name?: string;
    created_at?: string;
    last_updated_at?: string;
    flags?: number;
}

export interface JimakuFile {
    id: number;
    name: string;
    url: string;
    created_at?: string;
    size?: number;
}

export interface JimakuRateLimit {
    limit?: number;
    remaining?: number;
    resetAfterSeconds?: number;
}

export interface JimakuResponse<T> {
    data: T;
    rateLimit: JimakuRateLimit;
}

interface JimakuErrorPayload {
    error?: string;
    message?: string;
}

const parseJsonSafely = (text: string): unknown | undefined => {
    if (text.length === 0) {
        return undefined;
    }

    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
};

const defaultJimakuBaseUrl = 'https://jimaku.cc/api';
const defaultAjattBaseUrl = 'https://subtitles.ajatt.top';

type TrustedHtmlPolicyLike = {
    createHTML: (value: string) => string | TrustedHTML;
};

let trustedHtmlPolicy: TrustedHtmlPolicyLike | undefined;

const createTrustedHtml = (html: string): string | TrustedHTML => {
    const trustedTypesApi = (
        globalThis as typeof globalThis & {
            trustedTypes?: {
                createPolicy: (
                    name: string,
                    policy: { createHTML: (value: string) => string }
                ) => TrustedHtmlPolicyLike;
                getPolicy?: (name: string) => TrustedHtmlPolicyLike | null;
            };
        }
    ).trustedTypes;

    if (!trustedTypesApi) {
        return html;
    }

    if (!trustedHtmlPolicy) {
        try {
            trustedHtmlPolicy = trustedTypesApi.createPolicy('asbplayer-subtitle-sources', {
                createHTML: (value) => value,
            });
        } catch (error) {
            trustedHtmlPolicy = trustedTypesApi.getPolicy?.('asbplayer-subtitle-sources') ?? undefined;
        }
    }

    return trustedHtmlPolicy ? trustedHtmlPolicy.createHTML(html) : html;
};

const parseHtmlDocument = (html: string) => {
    const trustedHtml = createTrustedHtml(html);
    return new DOMParser().parseFromString(trustedHtml as string, 'text/html');
};

const parseRateLimit = (headers: Headers): JimakuRateLimit => ({
    limit: parseOptionalInt(headers.get('x-ratelimit-limit')),
    remaining: parseOptionalInt(headers.get('x-ratelimit-remaining')),
    resetAfterSeconds: parseOptionalInt(headers.get('x-ratelimit-reset-after')),
});

const parseOptionalInt = (value: string | null): number | undefined => {
    if (value === null) {
        return undefined;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const trimLeadingSlash = (path: string) => {
    if (path.startsWith('/')) {
        return path.substring(1);
    }

    return path;
};

const buildAjattDirectoryUrl = (animePath: string, baseUrl: string = defaultAjattBaseUrl) => {
    return new URL(trimLeadingSlash(animePath), `${baseUrl}/`).toString();
};

export interface JimakuClientOptions {
    apiKey: string;
    baseUrl?: string;
    minRequestIntervalMs?: number;
}

export class JimakuClient {
    private readonly _apiKey: string;
    private readonly _baseUrl: string;
    private readonly _minRequestIntervalMs: number;
    private _lastRequestTimestampMs?: number;

    constructor({ apiKey, baseUrl = defaultJimakuBaseUrl, minRequestIntervalMs = 1000 }: JimakuClientOptions) {
        const trimmedApiKey = apiKey.trim();

        if (trimmedApiKey.length === 0) {
            throw new Error('Jimaku API key cannot be empty or whitespace-only');
        }

        this._apiKey = trimmedApiKey;
        this._baseUrl = baseUrl;
        this._minRequestIntervalMs = minRequestIntervalMs;
    }

    async searchEntries(query: string): Promise<JimakuResponse<JimakuEntry[]>> {
        const searchParams = new URLSearchParams();
        searchParams.set('query', query);
        return await this._request<JimakuEntry[]>(`entries/search?${searchParams.toString()}`);
    }

    async getEntry(id: number): Promise<JimakuResponse<JimakuEntry>> {
        return await this._request<JimakuEntry>(`entries/${id}`);
    }

    async getFiles(
        id: number,
        options?: {
            episode?: number;
            language?: string;
        }
    ): Promise<JimakuResponse<JimakuFile[]>> {
        const searchParams = new URLSearchParams();

        if (options?.episode !== undefined) {
            searchParams.set('episode', `${options.episode}`);
        }

        if (options?.language) {
            searchParams.set('language', options.language);
        }

        const query = searchParams.toString();
        const endpoint = query.length > 0 ? `entries/${id}/files?${query}` : `entries/${id}/files`;
        return await this._request<JimakuFile[]>(endpoint);
    }

    private async _request<T>(endpoint: string): Promise<JimakuResponse<T>> {
        await this._waitIfNeeded();
        const response = await fetch(new URL(endpoint, `${this._baseUrl}/`).toString(), {
            headers: {
                Authorization: this._apiKey,
            },
        });
        this._lastRequestTimestampMs = Date.now();

        const rateLimit = parseRateLimit(response.headers);
        const bodyText = await response.text();
        const parsedBody = parseJsonSafely(bodyText) as T | JimakuErrorPayload | undefined;

        if (!response.ok) {
            const errorMessage =
                (parsedBody as JimakuErrorPayload | undefined)?.error ??
                (parsedBody as JimakuErrorPayload | undefined)?.message ??
                `Jimaku request failed with status ${response.status}`;
            throw new Error(errorMessage);
        }

        if (parsedBody === undefined) {
            throw new Error('Jimaku request failed: expected a JSON response body');
        }

        return {
            data: parsedBody as T,
            rateLimit,
        };
    }

    private async _waitIfNeeded() {
        if (this._lastRequestTimestampMs === undefined || this._minRequestIntervalMs <= 0) {
            return;
        }

        const elapsedMs = Date.now() - this._lastRequestTimestampMs;
        const remainingMs = this._minRequestIntervalMs - elapsedMs;

        if (remainingMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, remainingMs));
        }
    }
}

export interface AjattAnimeSearchResult {
    name: string;
    type?: string;
    englishName?: string;
    japaneseName?: string;
    lastModified?: string;
    path: string;
    url: string;
}

export interface AjattDirectoryFile {
    name: string;
    url: string;
}

// Homepage table columns:
// 0: row number, 1: linked title, 2: type, 3: english name, 4: japanese name, 5: last modified
const ajattColumns = {
    linkedTitle: 1,
    type: 2,
    englishName: 3,
    japaneseName: 4,
    lastModified: 5,
} as const;

export const searchAjatt = async (
    query: string,
    baseUrl: string = defaultAjattBaseUrl
): Promise<AjattAnimeSearchResult[]> => {
    const response = await fetch(`${baseUrl}/`);
    if (!response.ok) {
        throw new Error(`AJATT search failed with status ${response.status}`);
    }

    const html = await response.text();
    const document = parseHtmlDocument(html);
    const rows = document.querySelectorAll('table tr');
    const normalizedQuery = query.trim().toLowerCase();
    const matches: AjattAnimeSearchResult[] = [];

    for (const row of rows) {
        const cells = row.querySelectorAll('td');

        if (cells.length === 0) {
            continue;
        }

        const linkedCell = cells[ajattColumns.linkedTitle];
        const anchor = linkedCell?.querySelector('a[href]');
        const path = anchor?.getAttribute('href')?.trim();

        if (!path) {
            continue;
        }

        const name = linkedCell.textContent?.trim() ?? '';
        const type = cells[ajattColumns.type]?.textContent?.trim() || undefined;
        const englishName = cells[ajattColumns.englishName]?.textContent?.trim() || undefined;
        const japaneseName = cells[ajattColumns.japaneseName]?.textContent?.trim() || undefined;
        const lastModified = cells[ajattColumns.lastModified]?.textContent?.trim() || undefined;

        if (
            normalizedQuery.length > 0 &&
            ![name, englishName, japaneseName].some((v) => v?.toLowerCase().includes(normalizedQuery))
        ) {
            continue;
        }

        matches.push({
            name,
            type,
            englishName,
            japaneseName,
            lastModified,
            path,
            url: buildAjattDirectoryUrl(path, baseUrl),
        });
    }

    return matches;
};

const subtitleExtensions = ['.srt', '.ass'];

const isSubtitleLink = (href: string) => {
    const lower = href.toLowerCase();
    return subtitleExtensions.some((extension) => lower.endsWith(extension));
};

export const listAjattDirectoryFiles = async (
    animePath: string,
    baseUrl: string = defaultAjattBaseUrl
): Promise<AjattDirectoryFile[]> => {
    const directoryUrl = buildAjattDirectoryUrl(animePath, baseUrl);
    const response = await fetch(directoryUrl);
    if (!response.ok) {
        throw new Error(`AJATT directory listing failed with status ${response.status}`);
    }

    const html = await response.text();
    const document = parseHtmlDocument(html);
    const links = document.querySelectorAll('a[href]');
    const files: AjattDirectoryFile[] = [];
    const seenUrls = new Set<string>();

    for (const link of links) {
        const href = link.getAttribute('href')?.trim();

        if (!href || !isSubtitleLink(href)) {
            continue;
        }

        const url = new URL(href, directoryUrl).toString();

        if (seenUrls.has(url)) {
            continue;
        }

        seenUrls.add(url);
        files.push({
            name: link.textContent?.trim() || href,
            url,
        });
    }

    return files;
};
