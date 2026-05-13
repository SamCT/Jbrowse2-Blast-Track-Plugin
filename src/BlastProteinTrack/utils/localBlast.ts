import type { BlastQueryReport } from './ncbiBlast'
import type { BlastHit } from './types'

const defaultLocalBlastApiBase = '/api/blast'
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
  const localBlastApiBase = getLocalBlastApiBase()
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
  const localBlastApiBase = getLocalBlastApiBase()
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

function getLocalBlastApiBase() {
  return normalizeApiBase(
    globalLocalBlastApiBase() ??
      scriptLocalBlastApiBase() ??
      pageLocalBlastApiBase() ??
      defaultLocalBlastApiBase,
  )
}

function globalLocalBlastApiBase() {
  const config = (globalThis as typeof globalThis & {
    JBrowsePluginBlastTrack?: {
      blastApiBase?: unknown
      localBlastApiBase?: unknown
    }
  }).JBrowsePluginBlastTrack
  const value = config?.localBlastApiBase ?? config?.blastApiBase
  return typeof value === 'string' ? value : undefined
}

function scriptLocalBlastApiBase() {
  const document = globalThis.document
  const script = document?.currentScript as HTMLScriptElement | null | undefined
  return script ? apiBaseFromUrl(script.src) : undefined
}

function pageLocalBlastApiBase() {
  const location = globalThis.location
  return location ? apiBaseFromUrl(location.href) : undefined
}

function apiBaseFromUrl(url: string) {
  try {
    const params = new URL(url).searchParams
    return params.get('localBlastApiBase') ?? params.get('blastApiBase') ?? undefined
  } catch {
    return undefined
  }
}

function normalizeApiBase(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return defaultLocalBlastApiBase
  }
  return trimmed.replace(/\/+$/, '')
}

async function jsonFetch<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(localBlastFetchError({ message, response, url }))
  }
  return response.json() as Promise<T>
}

function localBlastFetchError({
  message,
  response,
  url,
}: {
  message: string
  response: Response
  url: string
}) {
  const contentType = response.headers.get('content-type') ?? ''
  const looksLikeHtml =
    contentType.includes('text/html') ||
    /^\s*<!doctype html/i.test(message) ||
    /^\s*<html/i.test(message)
  if (response.status === 404 && looksLikeHtml) {
    return [
      `Local BLAST API was not found at ${url}.`,
      'The server returned an HTML 404 page instead of JSON.',
      'Local BLAST requires a server endpoint such as /api/blast/dbs and /api/blast/search.',
      'If JBrowse is hosted under a subpath, set the plugin URL query parameter, for example ?blastApiBase=/private/jbrowse2/api/blast.',
    ].join(' ')
  }
  return `${response.status} ${response.statusText} from local BLAST${
    message ? `: ${message}` : ''
  }`
}
