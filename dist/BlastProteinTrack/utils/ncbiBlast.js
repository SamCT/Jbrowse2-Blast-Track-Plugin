const blastToolName = 'BlastTrack';
const submitIntervalMs = 10_000;
const initialPollSeconds = 30;
const waitingPollIntervalSeconds = 30;
let submitQueue = Promise.resolve();
let lastSubmitStartedAt = 0;
export async function queryBlast({ query, blastDatabase, blastProgram, contactEmail, hitLimit, baseUrl, onProgress, }) {
    const { rid, reports } = await queryBlastReports({
        query,
        blastDatabase,
        blastProgram,
        contactEmail,
        hitLimit,
        baseUrl,
        onProgress,
    });
    return {
        rid,
        hits: reports[0]?.hits ?? [],
    };
}
export async function queryBlastReports({ query, blastDatabase, blastProgram, contactEmail, hitLimit, baseUrl, onProgress, }) {
    onProgress('Submitting query to NCBI BLAST...');
    const rid = await submitBlastQuery({
        query,
        blastDatabase,
        blastProgram,
        contactEmail,
        hitLimit,
        baseUrl,
        onProgress,
    });
    await waitForBlastResults({
        rid,
        baseUrl,
        contactEmail,
        onProgress,
    });
    onProgress('Downloading BLAST alignments...');
    const result = await jsonFetch(`${baseUrl}?${blastParams({
        contactEmail,
        params: {
            CMD: 'Get',
            RID: rid,
            FORMAT_TYPE: 'JSON2_S',
            FORMAT_OBJECT: 'Alignment',
        },
    })}`);
    return {
        rid,
        reports: result.BlastOutput2.map(({ report }) => {
            const search = report.results.search;
            return {
                hits: search.hits ?? [],
                queryId: search.query_id,
                queryLength: search.query_len,
                queryTitle: search.query_title,
            };
        }),
    };
}
async function submitBlastQuery({ query, blastDatabase, blastProgram, contactEmail, hitLimit, baseUrl, onProgress, }) {
    return enqueueBlastSubmission({
        onProgress,
        submit: async () => {
            const body = blastParams({
                contactEmail,
                params: {
                    CMD: 'Put',
                    PROGRAM: blastProgram === 'quick-blastp' ? 'blastp' : blastProgram,
                    DATABASE: blastDatabase,
                    QUERY: query,
                    HITLIST_SIZE: String(hitLimit),
                    ...(blastDatabase === 'nr_clustered_seq'
                        ? {
                            CLUSTERED_DB: 'on',
                            DB_TYPE: 'Experimental Databases',
                        }
                        : {}),
                    ...(blastProgram === 'quick-blastp'
                        ? {
                            BLAST_PROGRAMS: 'kmerBlastp',
                        }
                        : {}),
                },
            });
            const response = await textFetch(baseUrl, { method: 'POST', body });
            const rid = /^ {4}RID = (.*$)/m.exec(response)?.[1];
            if (!rid) {
                throw new Error('Failed to get RID from NCBI BLAST response');
            }
            return rid;
        },
    });
}
async function waitForBlastResults({ rid, baseUrl, contactEmail, onProgress, }) {
    let nextPollSeconds = initialPollSeconds;
    while (true) {
        for (let i = nextPollSeconds; i > 0; i--) {
            onProgress(`Waiting for NCBI BLAST RID ${rid}. Checking again in ${i}s.`);
            await timeout(1000);
        }
        const response = await textFetch(`${baseUrl}?${blastParams({
            contactEmail,
            params: {
                CMD: 'Get',
                FORMAT_OBJECT: 'SearchInfo',
                RID: rid,
            },
        })}`);
        const waiting = /\s+Status=WAITING/m.test(response);
        const failed = /\s+Status=FAILED/m.test(response);
        const ready = /\s+Status=READY/m.test(response);
        const hasHits = /\s+ThereAreHits=yes/m.test(response);
        if (waiting) {
            nextPollSeconds = waitingPollIntervalSeconds;
            continue;
        }
        if (failed) {
            throw new Error(`NCBI BLAST RID ${rid} failed`);
        }
        if (ready) {
            if (hasHits) {
                return;
            }
            throw new Error('NCBI BLAST completed, but no hits were found');
        }
    }
}
function enqueueBlastSubmission({ onProgress, submit, }) {
    const queuedSubmission = submitQueue.then(async () => {
        const waitMs = Math.max(0, submitIntervalMs - (Date.now() - lastSubmitStartedAt));
        if (waitMs) {
            await waitForSubmitSlot({ onProgress, waitMs });
        }
        lastSubmitStartedAt = Date.now();
        return submit();
    });
    submitQueue = queuedSubmission.then(() => undefined, () => undefined);
    return queuedSubmission;
}
async function waitForSubmitSlot({ onProgress, waitMs, }) {
    for (let remaining = Math.ceil(waitMs / 1000); remaining > 0; remaining--) {
        onProgress(`Waiting ${remaining}s before submitting to respect NCBI BLAST rate limits.`);
        await timeout(Math.min(1000, waitMs));
        waitMs -= 1000;
    }
}
function blastParams({ contactEmail, params, }) {
    const email = contactEmail?.trim();
    return new URLSearchParams({
        ...params,
        tool: blastToolName,
        ...(email ? { email } : {}),
    });
}
async function textFetch(url, init) {
    const response = await fetch(url, init);
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText} from ${url}`);
    }
    return response.text();
}
async function jsonFetch(url, init) {
    const response = await textFetch(url, init);
    return JSON.parse(response);
}
function timeout(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}
