import { JimakuClient, listAjattDirectoryFiles, searchAjatt } from './subtitle-sources';

const createResponse = ({
    ok = true,
    status = 200,
    statusText = 'OK',
    jsonData,
    textData,
    headers = {},
}: {
    ok?: boolean;
    status?: number;
    statusText?: string;
    jsonData?: unknown;
    textData?: string;
    headers?: Record<string, string>;
}) => {
    return {
        ok,
        status,
        statusText,
        headers: {
            get: (key: string) => headers[key.toLowerCase()] ?? null,
        },
        text: async () => (textData !== undefined ? textData : JSON.stringify(jsonData)),
    } as unknown as Response;
};

describe('JimakuClient', () => {
    it('validates api key at construction', () => {
        expect(() => new JimakuClient({ apiKey: '   ' })).toThrow('Jimaku API key cannot be empty or whitespace-only');
    });

    it('searches entries with authorization header', async () => {
        const fetchMock = jest.fn().mockResolvedValue(
            createResponse({
                jsonData: [{ id: 729, name: 'Sousou no Frieren' }],
                headers: {
                    'x-ratelimit-limit': '100',
                    'x-ratelimit-remaining': '99',
                    'x-ratelimit-reset-after': '1',
                },
            })
        );
        global.fetch = fetchMock as unknown as typeof fetch;
        const client = new JimakuClient({ apiKey: 'test-key', minRequestIntervalMs: 0 });

        const response = await client.searchEntries('Sousou no Frieren');

        expect(fetchMock).toHaveBeenCalledWith('https://jimaku.cc/api/entries/search?query=Sousou+no+Frieren', {
            headers: { Authorization: 'test-key' },
        });
        expect(response.data).toHaveLength(1);
        expect(response.data[0].id).toBe(729);
        expect(response.rateLimit.limit).toBe(100);
        expect(response.rateLimit.remaining).toBe(99);
        expect(response.rateLimit.resetAfterSeconds).toBe(1);
    });

    it('requests files with optional filters', async () => {
        const fetchMock = jest.fn().mockResolvedValue(createResponse({ jsonData: [] }));
        global.fetch = fetchMock as unknown as typeof fetch;
        const client = new JimakuClient({ apiKey: 'test-key', minRequestIntervalMs: 0 });

        await client.getFiles(729, { episode: 1, language: 'ja' });

        expect(fetchMock).toHaveBeenCalledWith('https://jimaku.cc/api/entries/729/files?episode=1&language=ja', {
            headers: { Authorization: 'test-key' },
        });
    });

    it('throws parsed error message on failed request', async () => {
        const fetchMock = jest
            .fn()
            .mockResolvedValue(createResponse({ ok: false, status: 401, jsonData: { error: 'Unauthorized' } }));
        global.fetch = fetchMock as unknown as typeof fetch;
        const client = new JimakuClient({ apiKey: 'test-key', minRequestIntervalMs: 0 });

        await expect(client.getEntry(123)).rejects.toThrow('Unauthorized');
    });

    it('falls back to status-based error when response is not json', async () => {
        const fetchMock = jest.fn().mockResolvedValue(createResponse({ ok: false, status: 503, textData: '<html/>' }));
        global.fetch = fetchMock as unknown as typeof fetch;
        const client = new JimakuClient({ apiKey: 'test-key', minRequestIntervalMs: 0 });

        await expect(client.getEntry(123)).rejects.toThrow('Jimaku request failed with status 503');
    });

    it('throws when successful response does not contain valid json', async () => {
        const fetchMock = jest.fn().mockResolvedValue(createResponse({ ok: true, status: 200, textData: '<html/>' }));
        global.fetch = fetchMock as unknown as typeof fetch;
        const client = new JimakuClient({ apiKey: 'test-key', minRequestIntervalMs: 0 });

        await expect(client.getEntry(123)).rejects.toThrow('Jimaku request failed: expected a JSON response body');
    });
});

describe('AJATT subtitle source', () => {
    it('searches homepage entries by multiple title fields', async () => {
        const html = `
            <table>
                <tr>
                    <th>#</th><th>Name</th><th>Type</th><th>English name</th><th>Japanese name</th><th>Last modified</th>
                </tr>
                <tr>
                    <td>1</td>
                    <td><a href="/Sousou%20no%20Frieren/">Sousou no Frieren</a></td>
                    <td>Anime TV</td>
                    <td>Frieren: Beyond Journey's End</td>
                    <td>葬送のフリーレン</td>
                    <td>2024-10-01</td>
                </tr>
                <tr>
                    <td>2</td>
                    <td><a href="/Another%20Title/">Another Title</a></td>
                    <td>Anime TV</td>
                    <td>Another English</td>
                    <td>別のタイトル</td>
                    <td>2024-09-01</td>
                </tr>
            </table>
        `;
        const fetchMock = jest.fn().mockResolvedValue(createResponse({ textData: html }));
        global.fetch = fetchMock as unknown as typeof fetch;

        const matches = await searchAjatt('frieren');

        expect(fetchMock).toHaveBeenCalledWith('https://subtitles.ajatt.top/');
        expect(matches).toHaveLength(1);
        expect(matches[0]).toMatchObject({
            name: 'Sousou no Frieren',
            path: '/Sousou%20no%20Frieren/',
            url: 'https://subtitles.ajatt.top/Sousou%20no%20Frieren/',
        });
    });

    it('extracts subtitle files from an anime directory', async () => {
        const html = `
            <a href="../">../</a>
            <a href="Sousou.no.Frieren.S01E01.srt">Sousou.no.Frieren.S01E01.srt</a>
            <a href="Sousou.no.Frieren.S01E02.ass">Sousou.no.Frieren.S01E02.ass</a>
            <a href="Sousou.no.Frieren.Batch.zip">Sousou.no.Frieren.Batch.zip</a>
            <a href="notes.txt">notes.txt</a>
        `;
        const fetchMock = jest.fn().mockResolvedValue(createResponse({ textData: html }));
        global.fetch = fetchMock as unknown as typeof fetch;

        const files = await listAjattDirectoryFiles('/Sousou%20no%20Frieren/');

        expect(fetchMock).toHaveBeenCalledWith('https://subtitles.ajatt.top/Sousou%20no%20Frieren/');
        expect(files).toHaveLength(2);
        expect(files[0].url).toBe('https://subtitles.ajatt.top/Sousou%20no%20Frieren/Sousou.no.Frieren.S01E01.srt');
        expect(files[1].url).toBe('https://subtitles.ajatt.top/Sousou%20no%20Frieren/Sousou.no.Frieren.S01E02.ass');
    });

    it('throws when ajatt search request fails', async () => {
        const fetchMock = jest
            .fn()
            .mockResolvedValue(createResponse({ ok: false, status: 500, statusText: 'Server Error', textData: '' }));
        global.fetch = fetchMock as unknown as typeof fetch;

        await expect(searchAjatt('frieren')).rejects.toThrow('AJATT search failed with status 500');
    });

    it('throws when ajatt directory listing request fails', async () => {
        const fetchMock = jest.fn().mockResolvedValue(createResponse({ ok: false, status: 404, textData: '' }));
        global.fetch = fetchMock as unknown as typeof fetch;

        await expect(listAjattDirectoryFiles('/missing/')).rejects.toThrow(
            'AJATT directory listing failed with status 404'
        );
    });
});
