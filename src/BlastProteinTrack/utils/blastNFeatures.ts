import type { FromConfigFeature } from './blastTrackConfig'
import type { SelectedRegion } from './regionData'
import type { BlastHit, BlastHitDescription, BlastHsp } from './types'

export function featuresFromBlastNHits({
  hitLimit,
  hspLimit,
  hits,
  idPrefix,
  queryLength,
  region,
  showMismatchMarkers,
}: {
  hitLimit: number
  hspLimit: number
  hits: BlastHit[]
  idPrefix?: string
  queryLength: number
  region: SelectedRegion
  showMismatchMarkers: boolean
}) {
  return bestHits(hits, hitLimit, queryLength).flatMap((hit, hitIndex) => {
    const descriptions = hit.description ?? []
    const description = displayDescription(descriptions)
    const allHsps = hit.hsps.filter(hasQueryRange)
    const hsps = limitHsps(allHsps, hspLimit)
    if (!hsps.length) {
      return []
    }

    const hspBlocks = hsps.map((hsp, hspIndex) =>
      hspToRegionBlock({
        description,
        hitIndex,
        hsp,
        hspIndex,
        idPrefix,
        region,
      }),
    )
    const mismatchMarkers = showMismatchMarkers
      ? hsps.flatMap((hsp, hspIndex) =>
          hspMismatchMarkers({
            description,
            hitIndex,
            hsp,
            hspIndex,
            idPrefix,
            region,
          }),
        )
      : []
    const blocks = [...hspBlocks, ...mismatchMarkers]
    const start = Math.min(...hspBlocks.map(block => block.start))
    const end = Math.max(...hspBlocks.map(block => block.end))
    const label = hitLabel(description, hitIndex)
    const title = description.title?.trim()
    const totalAlignLength = sum(hsps, 'align_len')
    const totalIdentical = sum(hsps, 'identity')
    const bestHsp = [...hsps].sort(compareHsps)[0]
    const subjectRange = hspSubjectRange(hsps)

    return [
      {
        uniqueId: hitId(description, hitIndex, idPrefix),
        refName: region.refName,
        start,
        end,
        type: 'gene',
        name: label,
        id: label,
        gene_id: label,
        hitRank: hitIndex + 1,
        strand: hspStrand(bestHsp),
        score: bestBitScore(hsps),
        source: 'NCBI BLASTN',
        blastProgram: 'blastn',
        coordinateProjection:
          'Nucleotide HSP query coordinates projected over selected region',
        queryRegion: `${region.refName}:${region.start + 1}-${region.end}`,
        queryLengthBp: queryLength,
        accession: description.accession,
        ncbiId: description.id,
        description: title,
        note: title,
        scientificName: description.sciname,
        taxid: description.taxid,
        identity: weightedPercent(hsps, 'identity'),
        percentIdentity: weightedPercent(hsps, 'identity'),
        mismatches: totalMismatches(hsps),
        gaps: sum(hsps, 'gaps'),
        evalue: bestEvalue(hsps),
        bitScore: bestBitScore(hsps),
        totalAlignedNucleotides: totalAlignLength,
        identicalNucleotides: totalIdentical,
        queryCoverage: queryCoveragePct(hsps, queryLength),
        hspCount: hsps.length,
        bestHspIdentity: bestHsp ? hspStats(bestHsp).identity : undefined,
        bestHspEvalue: bestHsp?.evalue,
        bestHspBitScore: bestHsp?.bit_score,
        bestHspQueryRange: bestHsp
          ? `${bestHsp.query_from}-${bestHsp.query_to}`
          : undefined,
        subjectFrom: subjectRange?.from,
        subjectTo: subjectRange?.to,
        subjectLengthBp: hit.len,
        hitLength: hit.len,
        descriptionMemberCount: descriptions.length,
        allAccessions: joinedDescriptionField(descriptions, 'accession'),
        allDescriptions: joinedDescriptionField(descriptions, 'title'),
        maxHspsPerHit: hspLimit,
        availableHspCount: allHsps.length,
        mismatchMarkersShown: showMismatchMarkers,
        subfeatures: blocks,
      } satisfies FromConfigFeature,
    ]
  })
}

function hspToRegionBlock({
  description,
  hitIndex,
  hsp,
  hspIndex,
  idPrefix,
  region,
}: {
  description: { accession?: string; id?: string }
  hitIndex: number
  hsp: BlastHsp & Required<Pick<BlastHsp, 'query_from' | 'query_to'>>
  hspIndex: number
  idPrefix?: string
  region: SelectedRegion
}) {
  const start = region.start + Math.min(hsp.query_from, hsp.query_to) - 1
  const end = region.start + Math.max(hsp.query_from, hsp.query_to)
  return {
    uniqueId: `${hitId(description, hitIndex, idPrefix)}_hsp_${hspIndex + 1}`,
    refName: region.refName,
    type: 'CDS',
    start,
    end,
    name: `HSP ${hspIndex + 1}`,
    strand: hspStrand(hsp),
    source: 'NCBI BLASTN',
    hspNumber: hspIndex + 1,
    queryBpRange: `${Math.min(hsp.query_from, hsp.query_to)}-${Math.max(
      hsp.query_from,
      hsp.query_to,
    )}`,
    coordinateProjection: 'selected region',
    ...hspStats(hsp),
  }
}

function hspMismatchMarkers({
  description,
  hitIndex,
  hsp,
  hspIndex,
  idPrefix,
  region,
}: {
  description: { accession?: string; id?: string }
  hitIndex: number
  hsp: BlastHsp & Required<Pick<BlastHsp, 'query_from' | 'query_to'>>
  hspIndex: number
  idPrefix?: string
  region: SelectedRegion
}) {
  return hspMismatchPositions(hsp).map((mismatch, mismatchIndex) => {
    const start = region.start + mismatch.queryBp - 1
    return {
      uniqueId: `${hitId(description, hitIndex, idPrefix)}_hsp_${
        hspIndex + 1
      }_mismatch_${mismatchIndex + 1}`,
      refName: region.refName,
      type: mismatch.kind,
      start,
      end: start + 1,
      name:
        mismatch.kind === 'gap'
          ? `Gap Q${mismatch.queryBp}`
          : `Mismatch Q${mismatch.queryBp}`,
      strand: hspStrand(hsp),
      source: 'NCBI BLASTN',
      hspNumber: hspIndex + 1,
      queryBp: mismatch.queryBp,
      queryResidue: mismatch.queryResidue,
      subjectResidue: mismatch.subjectResidue,
      description:
        mismatch.kind === 'gap'
          ? `gap at query base ${mismatch.queryBp}`
          : `${mismatch.queryResidue}->${mismatch.subjectResidue} at query base ${mismatch.queryBp}`,
    }
  })
}

function hasQueryRange(hsp: BlastHsp): hsp is BlastHsp &
  Required<Pick<BlastHsp, 'query_from' | 'query_to'>> {
  return hsp.query_from !== undefined && hsp.query_to !== undefined
}

function hspMismatchPositions(
  hsp: BlastHsp & Required<Pick<BlastHsp, 'query_from' | 'query_to'>>,
) {
  const { qseq, hseq } = hsp
  if (!qseq || !hseq) {
    return []
  }

  const direction = hsp.query_to >= hsp.query_from ? 1 : -1
  let queryPos = hsp.query_from
  const mismatches: {
    kind: 'gap' | 'mismatch'
    queryBp: number
    queryResidue?: string
    subjectResidue?: string
  }[] = []

  for (let i = 0; i < qseq.length; i++) {
    const queryResidue = qseq[i]
    const subjectResidue = hseq[i]
    if (queryResidue === '-') {
      continue
    }

    if (subjectResidue === '-') {
      mismatches.push({
        kind: 'gap',
        queryBp: queryPos,
        queryResidue,
        subjectResidue,
      })
    } else if (
      queryResidue &&
      subjectResidue &&
      queryResidue.toUpperCase() !== subjectResidue.toUpperCase()
    ) {
      mismatches.push({
        kind: 'mismatch',
        queryBp: queryPos,
        queryResidue,
        subjectResidue,
      })
    }

    queryPos += direction
  }

  return mismatches
}

function hitId(
  description: { accession?: string; id?: string },
  index: number,
  prefix?: string,
) {
  const id = (
    description.accession ??
    description.id ??
    `blastn_hit_${index + 1}`
  ).replaceAll(/[^A-Za-z0-9_.-]/g, '_')
  return prefix ? `${prefix}_${id}` : id
}

function hitLabel(
  description: { accession?: string; id?: string; title?: string },
  index: number,
) {
  return description.accession ?? description.id ?? `BLASTN hit ${index + 1}`
}

function hspStats(hsp: BlastHsp) {
  const identity = percent(hsp.identity, hsp.align_len)
  return {
    evalue: hsp.evalue,
    bitScore: hsp.bit_score,
    score: hsp.score,
    identity,
    percentIdentity: identity,
    mismatches:
      hsp.align_len === undefined || hsp.identity === undefined
        ? undefined
        : hsp.align_len - hsp.identity - (hsp.gaps ?? 0),
    gaps: hsp.gaps,
    identicalNucleotides: hsp.identity,
    alignmentLengthBp: hsp.align_len,
    alignLength: hsp.align_len,
    queryFrom: hsp.query_from,
    queryTo: hsp.query_to,
    subjectFrom: hsp.hit_from,
    subjectTo: hsp.hit_to,
    description: `identity ${identity}%, e-value ${hsp.evalue ?? 'n/a'}`,
  }
}

function bestHits(hits: BlastHit[], hitLimit: number, queryLength: number) {
  return [...hits]
    .filter(hit => hit.hsps.some(hasQueryRange))
    .sort((a, b) => compareHits(a, b, queryLength))
    .slice(0, hitLimit)
}

function limitHsps(
  hsps: (BlastHsp & Required<Pick<BlastHsp, 'query_from' | 'query_to'>>)[],
  hspLimit: number,
) {
  return [...hsps].sort(compareHsps).slice(0, hspLimit)
}

function compareHits(a: BlastHit, b: BlastHit, queryLength: number) {
  const aStats = hitRankingStats(a, queryLength)
  const bStats = hitRankingStats(b, queryLength)
  const informativeDescriptionDiff =
    Number(bStats.hasInformativeDescription) -
    Number(aStats.hasInformativeDescription)
  if (
    informativeDescriptionDiff &&
    areComparableFunctionalMatches(aStats, bStats)
  ) {
    return informativeDescriptionDiff
  }
  const coverageDiff = bStats.queryCoverage - aStats.queryCoverage
  if (Math.abs(coverageDiff) >= 5) {
    return coverageDiff
  }
  const bitScoreDiff = bStats.bitScore - aStats.bitScore
  if (bitScoreDiff) {
    return bitScoreDiff
  }
  const alignedLengthDiff = bStats.alignedLength - aStats.alignedLength
  if (alignedLengthDiff) {
    return alignedLengthDiff
  }
  if (informativeDescriptionDiff) {
    return informativeDescriptionDiff
  }
  const evalueDiff = aStats.evalue - bStats.evalue
  if (evalueDiff) {
    return evalueDiff
  }
  const identityDiff = bStats.identity - aStats.identity
  if (identityDiff) {
    return identityDiff
  }
  return bStats.subjectLength - aStats.subjectLength
}

function areComparableFunctionalMatches(
  a: ReturnType<typeof hitRankingStats>,
  b: ReturnType<typeof hitRankingStats>,
) {
  return (
    Math.min(a.queryCoverage, b.queryCoverage) >= 50 &&
    Math.abs(a.queryCoverage - b.queryCoverage) <= 30
  )
}

function compareHsps(a: BlastHsp, b: BlastHsp) {
  const bitScoreDiff = (b.bit_score ?? 0) - (a.bit_score ?? 0)
  if (bitScoreDiff) {
    return bitScoreDiff
  }
  const alignedLengthDiff = (b.align_len ?? 0) - (a.align_len ?? 0)
  if (alignedLengthDiff) {
    return alignedLengthDiff
  }
  return (
    (a.evalue ?? Number.POSITIVE_INFINITY) -
    (b.evalue ?? Number.POSITIVE_INFINITY)
  )
}

function hspStrand(hsp?: BlastHsp) {
  return hsp?.hit_from !== undefined &&
    hsp.hit_to !== undefined &&
    hsp.hit_to < hsp.hit_from
    ? -1
    : 1
}

function bestEvalue(hsps: BlastHsp[]) {
  return Math.min(...hsps.map(hsp => hsp.evalue ?? Number.POSITIVE_INFINITY))
}

function bestBitScore(hsps: BlastHsp[]) {
  return Math.max(...hsps.map(hsp => hsp.bit_score ?? 0))
}

function hitRankingStats(hit: BlastHit, queryLength: number) {
  const hsps = hit.hsps.filter(hasQueryRange)
  return {
    alignedLength: queryCoveredLength(hsps),
    bitScore: bestBitScore(hsps),
    evalue: bestEvalue(hsps),
    hasInformativeDescription:
      hit.description?.some(isInformativeDescription) ?? false,
    identity: weightedPercent(hsps, 'identity'),
    queryCoverage: queryCoveragePct(hsps, queryLength),
    subjectLength: hit.len ?? 0,
  }
}

function weightedPercent(hsps: BlastHsp[], field: 'identity') {
  const numerator = sum(hsps, field)
  const denominator = sum(hsps, 'align_len')
  return percent(numerator, denominator)
}

function queryCoveragePct(hsps: BlastHsp[], queryLength: number) {
  return percent(queryCoveredLength(hsps), queryLength)
}

function queryCoveredLength(hsps: BlastHsp[]) {
  const covered = new Set<number>()
  for (const hsp of hsps) {
    if (hsp.query_from === undefined || hsp.query_to === undefined) {
      continue
    }
    const start = Math.min(hsp.query_from, hsp.query_to)
    const end = Math.max(hsp.query_from, hsp.query_to)
    for (let i = start; i <= end; i++) {
      covered.add(i)
    }
  }
  return covered.size
}

function hspSubjectRange(hsps: BlastHsp[]) {
  const coords = hsps.flatMap(hsp =>
    hsp.hit_from === undefined || hsp.hit_to === undefined
      ? []
      : [hsp.hit_from, hsp.hit_to],
  )
  return coords.length
    ? { from: Math.min(...coords), to: Math.max(...coords) }
    : undefined
}

function totalMismatches(hsps: BlastHsp[]) {
  return hsps.reduce((total, hsp) => {
    if (hsp.align_len === undefined || hsp.identity === undefined) {
      return total
    }
    return total + hsp.align_len - hsp.identity - (hsp.gaps ?? 0)
  }, 0)
}

function sum(hsps: BlastHsp[], field: keyof BlastHsp) {
  return hsps.reduce((total, hsp) => {
    const value = hsp[field]
    return typeof value === 'number' ? total + value : total
  }, 0)
}

function percent(numerator = 0, denominator = 0) {
  return denominator ? Number(((numerator / denominator) * 100).toFixed(2)) : 0
}

function displayDescription(descriptions: BlastHitDescription[]) {
  return descriptions.find(isInformativeDescription) ?? descriptions[0] ?? {}
}

function isInformativeDescription(description: BlastHitDescription) {
  const title = description.title?.trim()
  return Boolean(title && !isGenericTitle(title))
}

function isGenericTitle(title: string) {
  return /\b(hypothetical|uncharacteri[sz]ed|unnamed|predicted|unknown function)\b/i.test(
    title,
  )
}

function joinedDescriptionField(
  descriptions: BlastHitDescription[],
  field: 'accession' | 'title',
) {
  const values = descriptions
    .map(description => description[field]?.trim())
    .filter((value): value is string => Boolean(value))
  return values.length ? values.join(' | ') : undefined
}
