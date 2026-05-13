const localBlastApiBase = '/api/blast';
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
async function jsonFetch(url, init) {
    const response = await fetch(url, init);
    if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(`${response.status} ${response.statusText} from local BLAST${message ? `: ${message}` : ''}`);
    }
    return response.json();
}
