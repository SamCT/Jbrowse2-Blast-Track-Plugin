const defaultLocalBlastApiBase = '/api/blast';
const localDatabasePrefix = 'local:';
export function localBlastDatabaseValue(database) {
    return `${localDatabasePrefix}${database.id}`;
}
export function localBlastDatabaseId(value) {
    return value.startsWith(localDatabasePrefix)
        ? value.slice(localDatabasePrefix.length)
        : undefined;
}
export function isLocalBlastDatabaseValue(value) {
    return localBlastDatabaseId(value) !== undefined;
}
export function selectedLocalBlastDatabase({ databases, value, }) {
    const id = localBlastDatabaseId(value);
    return id ? databases.find(database => database.id === id) : undefined;
}
export async function fetchLocalBlastDatabases({ program, onProgress, }) {
    onProgress?.('Loading local BLAST databases...');
    const localBlastApiBase = getLocalBlastApiBase();
    const response = await jsonFetch(`${localBlastApiBase}/dbs?program=${encodeURIComponent(program)}`);
    return response.databases;
}
export async function queryLocalBlast({ allHits, query, blastDatabase, blastProgram, hitLimit, hspLimit, onProgress, }) {
    const { rid, reports } = await queryLocalBlastReports({
        allHits,
        query,
        blastDatabase,
        blastProgram,
        hitLimit,
        hspLimit,
        onProgress,
    });
    return {
        rid,
        hits: reports[0]?.hits ?? [],
    };
}
export async function queryLocalBlastReports({ allHits, query, blastDatabase, blastProgram, hitLimit, hspLimit, onProgress, }) {
    onProgress(`Running local ${blastProgram} against ${blastDatabase}...`);
    const localBlastApiBase = getLocalBlastApiBase();
    const response = await jsonFetch(`${localBlastApiBase}/search`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            allHits,
            database: blastDatabase,
            hitLimit,
            hspLimit,
            program: blastProgram,
            query,
        }),
    });
    onProgress(`Loaded local BLAST results from ${blastDatabase}.`);
    return response;
}
function getLocalBlastApiBase() {
    return normalizeApiBase(globalLocalBlastApiBase() ??
        scriptLocalBlastApiBase() ??
        pageLocalBlastApiBase() ??
        defaultLocalBlastApiBase);
}
function globalLocalBlastApiBase() {
    const config = globalThis.JBrowsePluginBlastTrack;
    const value = config?.localBlastApiBase ?? config?.blastApiBase;
    return typeof value === 'string' ? value : undefined;
}
function scriptLocalBlastApiBase() {
    const document = globalThis.document;
    const script = document?.currentScript;
    return script ? apiBaseFromUrl(script.src) : undefined;
}
function pageLocalBlastApiBase() {
    const location = globalThis.location;
    return location ? apiBaseFromUrl(location.href) : undefined;
}
function apiBaseFromUrl(url) {
    try {
        const params = new URL(url).searchParams;
        return params.get('localBlastApiBase') ?? params.get('blastApiBase') ?? undefined;
    }
    catch {
        return undefined;
    }
}
function normalizeApiBase(value) {
    const trimmed = value.trim();
    if (!trimmed) {
        return defaultLocalBlastApiBase;
    }
    return trimmed.replace(/\/+$/, '');
}
async function jsonFetch(url, init) {
    const response = await fetch(url, init);
    if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(localBlastFetchError({ message, response, url }));
    }
    return response.json();
}
function localBlastFetchError({ message, response, url, }) {
    const contentType = response.headers.get('content-type') ?? '';
    const looksLikeHtml = contentType.includes('text/html') ||
        /^\s*<!doctype html/i.test(message) ||
        /^\s*<html/i.test(message);
    if (response.status === 404 && looksLikeHtml) {
        return [
            `Local BLAST API was not found at ${url}.`,
            'The server returned an HTML 404 page instead of JSON.',
            'Local BLAST requires a server endpoint such as /api/blast/dbs and /api/blast/search.',
            'If JBrowse is hosted under a subpath, set the plugin URL query parameter, for example ?blastApiBase=/private/jbrowse2/api/blast.',
        ].join(' ');
    }
    return `${response.status} ${response.statusText} from local BLAST${message ? `: ${message}` : ''}`;
}
