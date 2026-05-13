import { TabixIndexedFile } from '@gmod/tabix'
import { RemoteFile } from 'generic-filehandle2'

import type { BlastQueryReport } from './ncbiBlast'
import type { BlastHit } from './types'

const localDatabasePrefix = 'local:'
const precomputedTableKind = 'precomputedBlastpTable'

const precomputedBlastColumns = [
  'qseqid',
  'sseqid',
  'pident',
  'length',
  'nident',
  'mismatch',
  'positive',
  'gapopen',
  'gaps',
  'qstart',
  'qend',
  'sstart',
  'send',
  'evalue',
  'bitscore',
  'qlen',
  'slen',
  'qcovhsp',
  'qcovs',
  'ppos',
] as const

export interface LocalBlastDatabase {
  id: string
  indexUrl?: string
  kind: typeof precomputedTableKind
  name: string
  title?: string
  type: 'protein'
  url: string
}

interface PrecomputedBlastTableConfig {
  id?: string
  indexUrl?: string
  name?: string
  title?: string
  url?: string
}

interface PrecomputedBlastRow {
  bitscore: number
  evalue: number
  gaps: number
  length: number
  nident: number
  positive: number
  qend: number
  qlen: number
  qseqid: string
  qstart: number
  send: number
  slen: number
  sseqid: string
  sstart: number
}

let pluginPrecomputedBlastTables: LocalBlastDatabase[] = []

export function setPluginPrecomputedBlastTables(pluginManager: {
  runtimePluginDefinitions?: unknown[]
}) {
  pluginPrecomputedBlastTables = configuredPrecomputedBlastTables(pluginManager)
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

export function isPrecomputedBlastDatabase(database?: LocalBlastDatabase) {
  return database?.kind === precomputedTableKind
}

export async function fetchLocalBlastDatabases({
  program,
  onProgress,
}: {
  program: 'blastp' | 'blastn'
  onProgress?: (message: string) => void
}) {
  if (program !== 'blastp') {
    return []
  }
  onProgress?.('Loading precomputed BLASTP tables...')
  const tables = getConfiguredPrecomputedBlastTables()
  if (!tables.length) {
    throw new Error(
      'No precomputed BLASTP tables are configured. Add precomputedBlastpTables to the BlastTrack plugin entry in config.json.',
    )
  }
  onProgress?.(`Loaded ${tables.length} precomputed BLASTP table(s).`)
  return tables
}

export async function queryLocalBlast({
  allHits,
  query,
  queryIds,
  blastDatabase,
  hitLimit,
  onProgress,
}: {
  allHits?: boolean
  blastDatabase: LocalBlastDatabase
  blastProgram: 'blastp' | 'blastn'
  hspLimit: number
  hitLimit: number
  onProgress: (message: string) => void
  query: string
  queryIds?: string[]
}): Promise<{ rid: string; hits: BlastHit[] }> {
  const { rid, reports } = await queryLocalBlastReports({
    allHits,
    query,
    queryIds,
    blastDatabase,
    hitLimit,
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
  queryIds,
  blastDatabase,
  hitLimit,
  onProgress,
}: {
  allHits?: boolean
  blastDatabase: LocalBlastDatabase
  blastProgram?: 'blastp' | 'blastn'
  hspLimit?: number
  hitLimit: number
  onProgress: (message: string) => void
  query: string
  queryIds?: string[]
}): Promise<{ rid: string; reports: BlastQueryReport[] }> {
  return queryPrecomputedBlastpTable({
    blastDatabase,
    hitLimit: allHits ? Number.POSITIVE_INFINITY : hitLimit,
    onProgress,
    query,
    queryIds,
  })
}

function getConfiguredPrecomputedBlastTables() {
  return [
    ...pluginPrecomputedBlastTables,
    ...globalPrecomputedBlastTables(),
    ...pagePrecomputedBlastTables(),
  ].filter(uniqueDatabase)
}

function configuredPrecomputedBlastTables(pluginManager: {
  runtimePluginDefinitions?: unknown[]
}) {
  const definitions = pluginManager.runtimePluginDefinitions ?? []
  return definitions.flatMap(definition => {
    const config = definition as {
      blastPrecomputedTables?: unknown
      name?: unknown
      precomputedBlastpTables?: unknown
    }
    if (config.name !== 'BlastTrack') {
      return []
    }
    return normalizePrecomputedBlastTables(
      config.precomputedBlastpTables ?? config.blastPrecomputedTables,
    )
  })
}

function globalPrecomputedBlastTables() {
  const config = (globalThis as typeof globalThis & {
    JBrowsePluginBlastTrack?: {
      blastPrecomputedTables?: unknown
      precomputedBlastpTables?: unknown
    }
  }).JBrowsePluginBlastTrack
  return normalizePrecomputedBlastTables(
    config?.precomputedBlastpTables ?? config?.blastPrecomputedTables,
  )
}

function pagePrecomputedBlastTables() {
  const location = globalThis.location
  if (!location) {
    return []
  }
  try {
    const params = new URL(location.href).searchParams
    const url = params.get('blastTableUrl') ?? params.get('precomputedBlastpUrl')
    if (!url) {
      return []
    }
    return normalizePrecomputedBlastTables([
      {
        indexUrl:
          params.get('blastTableIndexUrl') ??
          params.get('precomputedBlastpIndexUrl') ??
          undefined,
        name:
          params.get('blastTableName') ??
          params.get('precomputedBlastpName') ??
          'Precomputed BLASTP table',
        url,
      },
    ])
  } catch {
    return []
  }
}

function normalizePrecomputedBlastTables(value: unknown) {
  const configs = Array.isArray(value) ? value : []
  return configs.flatMap((config, index) => {
    const table = config as PrecomputedBlastTableConfig
    if (!table?.url) {
      return []
    }
    const url = absoluteUrl(table.url)
    const indexUrl = absoluteUrl(table.indexUrl || `${table.url}.tbi`)
    return [
      {
        id:
          table.id?.trim() ||
          `precomputed:${slugify(table.name || table.title || table.url)}:${index}`,
        indexUrl,
        kind: precomputedTableKind,
        name: table.name?.trim() || table.title?.trim() || table.url,
        title: table.title?.trim() || table.name?.trim() || table.url,
        type: 'protein',
        url,
      } satisfies LocalBlastDatabase,
    ]
  })
}

function absoluteUrl(url: string) {
  try {
    return new URL(url, globalThis.document?.baseURI ?? globalThis.location?.href)
      .href
  } catch {
    return url
  }
}

function uniqueDatabase(
  database: LocalBlastDatabase,
  index: number,
  databases: LocalBlastDatabase[],
) {
  return databases.findIndex(candidate => candidate.id === database.id) === index
}

async function queryPrecomputedBlastpTable({
  blastDatabase,
  hitLimit,
  onProgress,
  query,
  queryIds,
}: {
  blastDatabase: LocalBlastDatabase
  hitLimit: number
  onProgress: (message: string) => void
  query: string
  queryIds?: string[]
}) {
  const table = new TabixIndexedFile({
    filehandle: new RemoteFile(blastDatabase.url),
    tbiFilehandle: new RemoteFile(blastDatabase.indexUrl ?? `${blastDatabase.url}.tbi`),
  })
  const candidateIds = uniqueStrings([
    ...(queryIds ?? []),
    ...queryIdsFromFasta(query),
  ])

  onProgress(`Loading precomputed BLASTP hits from ${blastDatabase.name}...`)
  const reports: BlastQueryReport[] = []
  for (const queryId of candidateIds) {
    const rows = await readPrecomputedRows({ queryId, table })
    if (!rows.length) {
      continue
    }
    reports.push({
      hits: rowsToHits(rows, hitLimit),
      queryId,
      queryLength: rows[0]?.qlen,
      queryTitle: queryId,
    })
  }

  if (reports.length) {
    return {
      rid: `precomputed-${slugify(blastDatabase.id)}-${Date.now()}`,
      reports,
    }
  }

  throw new Error(
    `No precomputed BLASTP rows were found for ${candidateIds.join(
      ', ',
    )}. Confirm the table was indexed by qseqid and that the clicked feature ID matches the query FASTA ID.`,
  )
}

async function readPrecomputedRows({
  queryId,
  table,
}: {
  queryId: string
  table: TabixIndexedFile
}) {
  const rows: PrecomputedBlastRow[] = []
  try {
    await table.getLines(queryId, undefined, undefined, line => {
      const row = parsePrecomputedBlastLine(line)
      if (row) {
        rows.push(row)
      }
    })
  } catch {
    return []
  }
  return rows
}

function parsePrecomputedBlastLine(line: string): PrecomputedBlastRow | undefined {
  if (!line || line.startsWith('#')) {
    return undefined
  }
  const fields = line.split('\t')
  const offset = fields.length >= precomputedBlastColumns.length + 3 ? 3 : 0
  const values = Object.fromEntries(
    precomputedBlastColumns.map((column, index) => [
      column,
      fields[index + offset] ?? '',
    ]),
  ) as Record<(typeof precomputedBlastColumns)[number], string>
  if (!values.qseqid || !values.sseqid) {
    return undefined
  }

  return {
    bitscore: numberValue(values.bitscore),
    evalue: numberValue(values.evalue),
    gaps: numberValue(values.gaps),
    length: numberValue(values.length),
    nident: numberValue(values.nident),
    positive: numberValue(values.positive),
    qend: numberValue(values.qend),
    qlen: numberValue(values.qlen),
    qseqid: values.qseqid,
    qstart: numberValue(values.qstart),
    send: numberValue(values.send),
    slen: numberValue(values.slen),
    sseqid: values.sseqid,
    sstart: numberValue(values.sstart),
  }
}

function rowsToHits(rows: PrecomputedBlastRow[], hitLimit: number) {
  const bySubject = new Map<string, PrecomputedBlastRow[]>()
  for (const row of rows) {
    const subjectRows = bySubject.get(row.sseqid) ?? []
    subjectRows.push(row)
    bySubject.set(row.sseqid, subjectRows)
  }

  return [...bySubject.entries()]
    .map(([subjectId, subjectRows], index) => ({
      description: [
        {
          accession: subjectId,
          id: subjectId,
          title: subjectId,
        },
      ],
      hsps: subjectRows.map((row, hspIndex) => ({
        align_len: row.length,
        bit_score: row.bitscore,
        evalue: row.evalue,
        gaps: row.gaps,
        identity: row.nident,
        num: hspIndex + 1,
        positive: row.positive,
        query_from: row.qstart,
        query_to: row.qend,
        hit_from: row.sstart,
        hit_to: row.send,
      })),
      len: subjectRows.find(row => row.slen > 0)?.slen,
      num: index + 1,
    }))
    .sort(comparePrecomputedHits)
    .slice(0, Number.isFinite(hitLimit) ? hitLimit : undefined)
}

function comparePrecomputedHits(a: BlastHit, b: BlastHit) {
  const aBest = bestPrecomputedHsp(a)
  const bBest = bestPrecomputedHsp(b)
  const bitScoreDiff = (bBest?.bit_score ?? 0) - (aBest?.bit_score ?? 0)
  if (bitScoreDiff) {
    return bitScoreDiff
  }
  return (
    (aBest?.evalue ?? Number.POSITIVE_INFINITY) -
    (bBest?.evalue ?? Number.POSITIVE_INFINITY)
  )
}

function bestPrecomputedHsp(hit: BlastHit) {
  return [...hit.hsps].sort((a, b) => {
    const bitScoreDiff = (b.bit_score ?? 0) - (a.bit_score ?? 0)
    if (bitScoreDiff) {
      return bitScoreDiff
    }
    return (
      (a.evalue ?? Number.POSITIVE_INFINITY) -
      (b.evalue ?? Number.POSITIVE_INFINITY)
    )
  })[0]
}

function queryIdsFromFasta(query: string) {
  return query
    .split('\n')
    .filter(line => line.startsWith('>'))
    .map(line => line.slice(1).trim().split(/\s+/)[0])
    .filter(Boolean)
}

function numberValue(value: string) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function slugify(value: string) {
  return value.replaceAll(/[^A-Za-z0-9_.-]/g, '_')
}
