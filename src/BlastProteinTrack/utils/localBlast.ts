import type { BlastQueryReport } from './ncbiBlast'
import type { BlastHit } from './types'

const localBlastApiBase = '/api/blast'
const localDatabasePrefix = 'local:'

export interface LocalBlastDatabase {
  id: string
  name: string
  title?: string
  type: 'protein' | 'nucleotide'
}

export function localBlastDatabaseValue(database: LocalBlastDatabase) {
  return `${localDatabasePrefix}${database.id}`
}

export function localBlastDatabaseId(value: string) {
  return value.startsWith(localDatabasePrefix)
    ? value.slice(localDatabasePrefix.length)
    : undefined
}

export function isLocalBlastDatabaseValue(value: string) {
  return localBlastDatabaseId(value) !== undefined
}

export function selectedLocalBlastDatabase({
  databases,
  value,
}: {
  databases: LocalBlastDatabase[]
  value: string
}) {
  const id = localBlastDatabaseId(value)
  return id ? databases.find(database => database.id === id) : undefined
}

export async function fetchLocalBlastDatabases({
  program,
  onProgress,
}: {
  program: 'blastp' | 'blastn'
  onProgress?: (message: string) => void
}) {
  onProgress?.('Loading local BLAST databases...')
  const response = await jsonFetch<{ databases: LocalBlastDatabase[] }>(
    `${localBlastApiBase}/dbs?program=${encodeURIComponent(program)}`,
  )
  return response.databases
}

export async function queryLocalBlast({
  allHits,
  query,
  blastDatabase,
  blastProgram,
  hitLimit,
  hspLimit,
  onProgress,
}: {
  allHits?: boolean
  query: string
  blastDatabase: string
  blastProgram: 'blastp' | 'blastn'
  hitLimit: number
  hspLimit: number
  onProgress: (message: string) => void
}): Promise<{ rid: string; hits: BlastHit[] }> {
  const { rid, reports } = await queryLocalBlastReports({
    allHits,
    query,
    blastDatabase,
    blastProgram,
    hitLimit,
    hspLimit,
    onProgress,
  })
  return {
    rid,
    hits: reports[0]?.hits ?? [],
  }
}

export async function queryLocalBlastReports({
  allHits,
  query,
  blastDatabase,
  blastProgram,
  hitLimit,
  hspLimit,
  onProgress,
}: {
  allHits?: boolean
  query: string
  blastDatabase: string
  blastProgram: 'blastp' | 'blastn'
  hitLimit: number
  hspLimit: number
  onProgress: (message: string) => void
}): Promise<{ rid: string; reports: BlastQueryReport[] }> {
  onProgress(`Running local ${blastProgram} against ${blastDatabase}...`)
  const response = await jsonFetch<{
    reports: BlastQueryReport[]
    rid: string
  }>(`${localBlastApiBase}/search`, {
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
  })
  onProgress(`Loaded local BLAST results from ${blastDatabase}.`)
  return response
}

async function jsonFetch<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(
      `${response.status} ${response.statusText} from local BLAST${message ? `: ${message}` : ''}`,
    )
  }
  return response.json() as Promise<T>
}
