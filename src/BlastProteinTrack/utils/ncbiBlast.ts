import type { BlastHit, BlastResults } from './types'

const blastToolName = 'BlastTrack'
const submitIntervalMs = 10_000
const initialPollSeconds = 30
const waitingPollIntervalSeconds = 30
const maximumCandidateHits = 100

let submitQueue = Promise.resolve()
let lastSubmitStartedAt = 0

export interface BlastQueryReport {
  hits: BlastHit[]
  queryId?: string
  queryLength?: number
  queryTitle?: string
}

export async function queryBlast({
  query,
  blastDatabase,
  blastProgram,
  contactEmail,
  hitLimit,
  baseUrl,
  onProgress,
}: {
  query: string
  blastDatabase: string
  blastProgram: string
  contactEmail?: string
  hitLimit: number
  baseUrl: string
  onProgress: (arg: string) => void
}): Promise<{ rid: string; hits: BlastHit[] }> {
  const { rid, reports } = await queryBlastReports({
    query,
    blastDatabase,
    blastProgram,
    contactEmail,
    hitLimit,
    baseUrl,
    onProgress,
  })

  return {
    rid,
    hits: reports[0]?.hits ?? [],
  }
}

export async function queryBlastReports({
  query,
  blastDatabase,
  blastProgram,
  contactEmail,
  hitLimit,
  baseUrl,
  onProgress,
}: {
  query: string
  blastDatabase: string
  blastProgram: string
  contactEmail?: string
  hitLimit: number
  baseUrl: string
  onProgress: (arg: string) => void
}): Promise<{ rid: string; reports: BlastQueryReport[] }> {
  const candidateLimit = candidateHitLimit({
    displayHitLimit: hitLimit,
  })
  onProgress('Submitting query to NCBI BLAST...')
  const rid = await submitBlastQuery({
    query,
    blastDatabase,
    blastProgram,
    contactEmail,
    candidateLimit,
    baseUrl,
    onProgress,
  })
  await waitForBlastResults({
    rid,
    baseUrl,
    contactEmail,
    onProgress,
  })
  onProgress(`Downloading top ${candidateLimit} BLAST candidate alignments...`)
  const result = await jsonFetch<BlastResults>(`${baseUrl}?${blastParams({
    contactEmail,
    params: {
      CMD: 'Get',
      RID: rid,
      ALIGNMENTS: String(candidateLimit),
      DESCRIPTIONS: String(candidateLimit),
      FORMAT_TYPE: 'JSON2_S',
      FORMAT_OBJECT: 'Alignment',
    },
  })}`)

  return {
    rid,
    reports: result.BlastOutput2.map(({ report }) => {
      const search = report.results.search
      return {
        hits: search.hits ?? [],
        queryId: search.query_id,
        queryLength: search.query_len,
        queryTitle: search.query_title,
      }
    }),
  }
}

async function submitBlastQuery({
  query,
  blastDatabase,
  blastProgram,
  contactEmail,
  candidateLimit,
  baseUrl,
  onProgress,
}: {
  query: string
  blastDatabase: string
  blastProgram: string
  contactEmail?: string
  candidateLimit: number
  baseUrl: string
  onProgress: (arg: string) => void
}) {
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
          HITLIST_SIZE: String(candidateLimit),
          ...(blastProgram === 'quick-blastp'
            ? {
                BLAST_PROGRAMS: 'kmerBlastp',
              }
            : {}),
        },
      })
      const response = await textFetch(baseUrl, { method: 'POST', body })
      const rid = /^ {4}RID = (.*$)/m.exec(response)?.[1]
      if (!rid) {
        throw new Error('Failed to get RID from NCBI BLAST response')
      }
      return rid
    },
  })
}

async function waitForBlastResults({
  rid,
  baseUrl,
  contactEmail,
  onProgress,
}: {
  rid: string
  baseUrl: string
  contactEmail?: string
  onProgress: (arg: string) => void
}) {
  let nextPollSeconds = initialPollSeconds

  while (true) {
    for (let i = nextPollSeconds; i > 0; i--) {
      onProgress(`Waiting for NCBI BLAST RID ${rid}. Checking again in ${i}s.`)
      await timeout(1000)
    }

    const response = await textFetch(`${baseUrl}?${blastParams({
      contactEmail,
      params: {
        CMD: 'Get',
        FORMAT_OBJECT: 'SearchInfo',
        RID: rid,
      },
    })}`)
    const waiting = /\s+Status=WAITING/m.test(response)
    const failed = /\s+Status=FAILED/m.test(response)
    const ready = /\s+Status=READY/m.test(response)
    const hasHits = /\s+ThereAreHits=yes/m.test(response)

    if (waiting) {
      nextPollSeconds = waitingPollIntervalSeconds
      continue
    }
    if (failed) {
      throw new Error(`NCBI BLAST RID ${rid} failed`)
    }
    if (ready) {
      if (hasHits) {
        return
      }
      throw new Error('NCBI BLAST completed, but no hits were found')
    }
  }
}

function enqueueBlastSubmission<T>({
  onProgress,
  submit,
}: {
  onProgress: (arg: string) => void
  submit: () => Promise<T>
}) {
  const queuedSubmission = submitQueue.then(async () => {
    const waitMs = Math.max(0, submitIntervalMs - (Date.now() - lastSubmitStartedAt))
    if (waitMs) {
      await waitForSubmitSlot({ onProgress, waitMs })
    }
    lastSubmitStartedAt = Date.now()
    return submit()
  })
  submitQueue = queuedSubmission.then(
    () => undefined,
    () => undefined,
  )
  return queuedSubmission
}

async function waitForSubmitSlot({
  onProgress,
  waitMs,
}: {
  onProgress: (arg: string) => void
  waitMs: number
}) {
  for (let remaining = Math.ceil(waitMs / 1000); remaining > 0; remaining--) {
    onProgress(
      `Waiting ${remaining}s before submitting to respect NCBI BLAST rate limits.`,
    )
    await timeout(Math.min(1000, waitMs))
    waitMs -= 1000
  }
}

function blastParams({
  contactEmail,
  params,
}: {
  contactEmail?: string
  params: Record<string, string>
}) {
  const email = contactEmail?.trim()
  return new URLSearchParams({
    ...params,
    tool: blastToolName,
    ...(email ? { email } : {}),
  })
}

function candidateHitLimit({
  displayHitLimit,
}: {
  displayHitLimit: number
}) {
  const requestedDisplayHits = Math.max(1, Math.floor(displayHitLimit))
  return Math.min(maximumCandidateHits, requestedDisplayHits)
}

async function textFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${url}`)
  }
  return response.text()
}

async function jsonFetch<T>(url: string, init?: RequestInit) {
  const response = await textFetch(url, init)
  return JSON.parse(response) as T
}

function timeout(ms: number) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}
