import { getFeatureName } from './featureSequence'
import { getBestCdsSet } from './proteinFromCds'

import type { FromConfigFeature } from './blastTrackConfig'
import type { JsonFeature } from './proteinFromCds'
import type { Feature } from '@jbrowse/core/util'

export type QueryGeneBlastStatus =
  | 'hits'
  | 'no_hits'
  | 'no_report'
  | 'no_sequence'

export function queryGeneFeature({
  feature,
  hitCount,
  idPrefix,
  reportMatchedBy,
  reportQueryId,
  reportQueryTitle,
  status,
  statusDetail,
}: {
  feature: Feature
  hitCount: number
  idPrefix: string
  reportMatchedBy?: string
  reportQueryId?: string
  reportQueryTitle?: string
  status: QueryGeneBlastStatus
  statusDetail?: string
}): FromConfigFeature {
  const json = feature.toJSON() as JsonFeature & {
    refName?: string
  }
  const name = String(getFeatureName(feature))
  const refName = json.refName ?? (feature.get('refName') as string)
  const cds = getBestCdsSet(json)
  const description = [statusDescription(status, hitCount), statusDetail]
    .filter(Boolean)
    .join('; ')

  return {
    uniqueId: `${idPrefix}_query`,
    refName,
    start: json.start,
    end: json.end,
    type: status === 'hits' ? 'gene' : 'match',
    name: status === 'hits' ? name : `${name} (${statusLabel(status)})`,
    id: `${name}_blast_query`,
    gene_id: name,
    strand: json.strand ?? 1,
    source: 'BLASTP query gene',
    blastProgram: 'blastp',
    blastRole: 'query',
    blastStatus: status,
    reportMatchedBy,
    reportQueryId,
    reportQueryTitle,
    queryFeature: name,
    hitCount,
    description,
    note: description,
    subfeatures:
      status === 'hits'
        ? cds.map((sub, index) => ({
            uniqueId: `${idPrefix}_query_cds_${index + 1}`,
            refName,
            start: sub.start,
            end: sub.end,
            type: 'CDS',
            name: `query CDS ${index + 1}`,
            strand: sub.strand ?? json.strand ?? 1,
            source: 'BLASTP query gene',
            blastRole: 'query',
            blastStatus: status,
            description,
          }))
        : undefined,
  }
}

function statusDescription(status: QueryGeneBlastStatus, hitCount: number) {
  if (status === 'hits') {
    return `BLASTP query gene; ${hitCount} hit${hitCount === 1 ? '' : 's'} rendered`
  }
  if (status === 'no_sequence') {
    return 'BLASTP query gene; no CDS/protein sequence was available, so it was not submitted'
  }
  if (status === 'no_report') {
    return 'BLASTP query gene; NCBI returned BLAST output, but no report could be confidently matched to this query'
  }
  return 'BLASTP query gene; submitted, but no BLAST hits were returned'
}

function statusLabel(status: QueryGeneBlastStatus) {
  if (status === 'no_hits') {
    return 'confirmed no hit'
  }
  if (status === 'no_report') {
    return 'unmatched report'
  }
  if (status === 'no_sequence') {
    return 'no sequence'
  }
  return 'query'
}
