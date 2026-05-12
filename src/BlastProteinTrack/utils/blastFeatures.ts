import { getFeatureName } from './featureSequence'
import { getBestCdsSet } from './proteinFromCds'

import type { BlastHit, BlastHitDescription, BlastHsp } from './types'
import type { JsonFeature } from './proteinFromCds'
import type { Feature } from '@jbrowse/core/util'

interface FromConfigFeature {
  uniqueId: string
  refName: string
  start: number
  end: number
  type: string
  name: string
  score?: number
  strand?: number
  [key: string]: unknown
}

interface CodingSegment {
  start: number
  end: number
  codingStart: number
  codingEnd: number
  strand: number
}

interface RankedHit {
  hit: BlastHit
  stats: HitRankingStats
}

interface HitRankingStats {
  alignedLength: number
  bitScore: number
  evalue: number
  hasInformativeDescription: boolean
  identity: number
  isLongerSubjectMatch: boolean
  isLikelyCompleteAnnotatedMatch: boolean
  isStrongQueryLengthMatch: boolean
  queryCoverage: number
  rankingScore: number
  productKey: string
  subjectGeneKey: string
  subjectLength: number
  subjectToQueryLengthRatio: number
}

export function featuresFromBlastHits({
  hspLimit,
  hits,
  idPrefix,
  queryFeature,
  queryProteinLength,
  hitLimit,
  showMismatchMarkers,
}: {
  hspLimit: number
  hits: BlastHit[]
  idPrefix?: string
  queryFeature: Feature
  queryProteinLength: number
  hitLimit: number
  showMismatchMarkers: boolean
}) {
  const refName = queryFeature.get('refName') as string
  const queryStart = queryFeature.get('start') as number
  const queryEnd = queryFeature.get('end') as number
  const queryStrand = (queryFeature.get('strand') as number | undefined) ?? 1
  const queryLength = Math.max(1, queryEnd - queryStart)
  const codingSegments = getCodingSegments(queryFeature)

  return bestHits(hits, hitLimit, queryProteinLength).flatMap((hit, hitIndex) => {
    const descriptions = hit.description ?? []
    const description = displayDescription(descriptions)
    const allHsps = hit.hsps.filter(hasQueryRange)
    const hsps = limitHsps(allHsps, hspLimit)
    if (!hsps.length) {
      return []
    }
    const rankingStats = hitRankingStats(hit, queryProteinLength)
    const blastCandidateClass = candidateClass(rankingStats)

    const hspBlocks = hsps.flatMap((hsp, hspIndex) =>
      hspToCdsBlocks({
        blastCandidateClass,
        description,
        hitIndex,
        hsp,
        hspIndex,
        idPrefix,
        refName,
        queryEnd,
        queryLength,
        queryProteinLength,
        queryStart,
        queryStrand,
        codingSegments,
        subjectToQueryLengthRatio: rankingStats.subjectToQueryLengthRatio,
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
            refName,
            queryEnd,
            queryLength,
            queryProteinLength,
            queryStart,
            queryStrand,
            codingSegments,
          }),
        )
      : []
    const blocks = [...hspBlocks, ...mismatchMarkers]
    if (!hspBlocks.length) {
      return []
    }
    const start = Math.min(...hspBlocks.map(block => block.start))
    const end = Math.max(...hspBlocks.map(block => block.end))
    const label = hitLabel(description, hitIndex)
    const title = description.title?.trim()
    const totalAlignLength = sum(hsps, 'align_len')
    const totalIdentical = sum(hsps, 'identity')
    const totalPositive = sum(hsps, 'positive')
    const identity = weightedPercent(hsps, 'identity')
    const positives = weightedPercent(hsps, 'positive')
    const mismatches = totalMismatches(hsps)
    const gaps = sum(hsps, 'gaps')
    const evalue = bestEvalue(hsps)
    const bitScore = bestBitScore(hsps)
    const queryCoverage = queryCoveragePct(hsps, queryProteinLength)
    const bestHsp = [...hsps].sort(compareHsps)[0]
    const subjectRange = hspSubjectRange(hsps)

    return [
      {
        uniqueId: hitId(description, hitIndex, idPrefix),
        refName,
        start,
        end,
        type: 'gene',
        name: label,
        hitRank: hitIndex + 1,
        identity,
        percentIdentity: identity,
        queryCoverage,
        evalue,
        bitScore,
        positives,
        percentPositives: positives,
        mismatches,
        gaps,
        hspCount: hsps.length,
        candidateClass: blastCandidateClass,
        blastCandidateClass,
        subjectToQueryLengthRatio: rankingStats.subjectToQueryLengthRatio,
        strand: queryStrand,
        score: bitScore,
        source: 'NCBI BLASTP',
        blastProgram: 'blastp',
        coordinateProjection: codingSegments.length
          ? 'Protein HSP query coordinates projected onto CDS exons'
          : 'Protein HSP query coordinates projected over feature span; no CDS subfeatures found',
        id: label,
        gene_id: label,
        queryFeature: getFeatureName(queryFeature),
        queryProteinLengthAa: queryProteinLength,
        accession: description.accession,
        ncbiId: description.id,
        description: title,
        note: title,
        scientificName: description.sciname,
        taxid: description.taxid,
        totalAlignedAminoAcids: totalAlignLength,
        identicalAminoAcids: totalIdentical,
        positiveAminoAcids: totalPositive,
        bestHspIdentity: bestHsp ? hspStats(bestHsp).identity : undefined,
        bestHspEvalue: bestHsp?.evalue,
        bestHspBitScore: bestHsp?.bit_score,
        bestHspQueryRange: bestHsp
          ? `${bestHsp.query_from}-${bestHsp.query_to}`
          : undefined,
        subjectFrom: subjectRange?.from,
        subjectTo: subjectRange?.to,
        subjectProteinLengthAa: hit.len,
        hitLength: hit.len,
        descriptionMemberCount: descriptions.length,
        allAccessions: joinedDescriptionField(descriptions, 'accession'),
        allDescriptions: joinedDescriptionField(descriptions, 'title'),
        deduplicatedProductKey: rankingStats.productKey,
        deduplicatedSubjectGeneKey: rankingStats.subjectGeneKey,
        rankingScore: rankingStats.rankingScore,
        maxHspsPerHit: hspLimit,
        availableHspCount: allHsps.length,
        mismatchMarkersShown: showMismatchMarkers,
        subfeatures: blocks,
      } satisfies FromConfigFeature,
    ]
  })
}

function hasQueryRange(hsp: BlastHsp): hsp is BlastHsp &
  Required<Pick<BlastHsp, 'query_from' | 'query_to'>> {
  return hsp.query_from !== undefined && hsp.query_to !== undefined
}

function proteinPositionToGenomeOffset({
  proteinPosition,
  queryProteinLength,
  queryLength,
}: {
  proteinPosition: number
  queryProteinLength: number
  queryLength: number
}) {
  return Math.round(((proteinPosition - 1) / queryProteinLength) * queryLength)
}

function getCodingSegments(feature: Feature): CodingSegment[] {
  const json = feature.toJSON() as JsonFeature
  const strand = json.strand ?? 1
  const cds = getBestCdsSet(json)
  const orderedCds = [...cds].sort((a, b) =>
    strand === -1 ? b.start - a.start : a.start - b.start,
  )
  let offset = 0
  return orderedCds.map(sub => {
    const length = sub.end - sub.start
    const segment = {
      start: sub.start,
      end: sub.end,
      codingStart: offset,
      codingEnd: offset + length,
      strand,
    }
    offset += length
    return segment
  })
}

function hspToCdsBlocks({
  blastCandidateClass,
  description,
  hitIndex,
  hsp,
  hspIndex,
  idPrefix,
  refName,
  queryEnd,
  queryLength,
  queryProteinLength,
  queryStart,
  queryStrand,
  codingSegments,
  subjectToQueryLengthRatio,
}: {
  blastCandidateClass?: string
  description: { accession?: string; id?: string }
  hitIndex: number
  hsp: BlastHsp & Required<Pick<BlastHsp, 'query_from' | 'query_to'>>
  hspIndex: number
  idPrefix?: string
  refName: string
  queryEnd: number
  queryLength: number
  queryProteinLength: number
  queryStart: number
  queryStrand: number
  codingSegments: CodingSegment[]
  subjectToQueryLengthRatio?: number
}) {
  const codingStart = (Math.min(hsp.query_from, hsp.query_to) - 1) * 3
  const codingEnd = Math.max(hsp.query_from, hsp.query_to) * 3
  const stats = hspStats(hsp)
  const ranges = codingSegments.length
    ? codingIntervalToGenomeRanges(codingStart, codingEnd, codingSegments)
    : wholeFeatureProteinRanges({
        codingStart,
        codingEnd,
        queryEnd,
        queryLength,
        queryProteinLength,
        queryStart,
        queryStrand,
      })

  return ranges.map((range, partIndex) => ({
    uniqueId: `${hitId(description, hitIndex, idPrefix)}_hsp_${hspIndex + 1}_part_${
      partIndex + 1
    }`,
    refName,
    type: 'CDS',
    start: range.start,
    end: range.end,
    name:
      ranges.length === 1
        ? `HSP ${hspIndex + 1}`
        : `HSP ${hspIndex + 1}.${partIndex + 1}`,
    strand: queryStrand,
    source: 'NCBI BLASTP',
    blastCandidateClass,
    candidateClass: blastCandidateClass,
    subjectToQueryLengthRatio,
    hspNumber: hspIndex + 1,
    hspPart: partIndex + 1,
    queryAaRange: `${Math.min(hsp.query_from, hsp.query_to)}-${Math.max(
      hsp.query_from,
      hsp.query_to,
    )}`,
    coordinateProjection: codingSegments.length ? 'CDS exon segment' : 'feature span',
    ...stats,
  }))
}

function codingIntervalToGenomeRanges(
  codingStart: number,
  codingEnd: number,
  codingSegments: CodingSegment[],
) {
  return codingSegments.flatMap(segment => {
    const overlapStart = Math.max(codingStart, segment.codingStart)
    const overlapEnd = Math.min(codingEnd, segment.codingEnd)
    if (overlapStart >= overlapEnd) {
      return []
    }

    const localStart = overlapStart - segment.codingStart
    const localEnd = overlapEnd - segment.codingStart
    return [
      segment.strand === -1
        ? {
            start: segment.end - localEnd,
            end: segment.end - localStart,
          }
        : {
            start: segment.start + localStart,
            end: segment.start + localEnd,
          },
    ]
  })
}

function wholeFeatureProteinRanges({
  codingStart,
  codingEnd,
  queryEnd,
  queryLength,
  queryProteinLength,
  queryStart,
  queryStrand,
}: {
  codingStart: number
  codingEnd: number
  queryEnd: number
  queryLength: number
  queryProteinLength: number
  queryStart: number
  queryStrand: number
}) {
  const start = proteinPositionToGenomeOffset({
    proteinPosition: codingStart / 3 + 1,
    queryProteinLength,
    queryLength,
  })
  const end = proteinPositionToGenomeOffset({
    proteinPosition: codingEnd / 3 + 1,
    queryProteinLength,
    queryLength,
  })
  return [
    queryStrand >= 0
      ? { start: queryStart + start, end: queryStart + end }
      : { start: queryEnd - end, end: queryEnd - start },
  ]
}

function hspMismatchMarkers(args: Parameters<typeof hspToCdsBlocks>[0]) {
  const { hsp, codingSegments } = args
  const mismatches = hspMismatchPositions(hsp)
  if (!mismatches.length || !codingSegments.length) {
    return []
  }

  return mismatches.flatMap((mismatch, mismatchIndex) => {
    const codingStart = (mismatch.queryAa - 1) * 3
    const codingEnd = mismatch.queryAa * 3
    const ranges = codingIntervalToGenomeRanges(
      codingStart,
      codingEnd,
      codingSegments,
    )
    return ranges.map((range, partIndex) => ({
      uniqueId: `${hitId(args.description, args.hitIndex, args.idPrefix)}_hsp_${
        args.hspIndex + 1
      }_mismatch_${mismatchIndex + 1}_${partIndex + 1}`,
      refName: args.refName,
      type: mismatch.kind,
      start: range.start,
      end: range.end,
      name:
        mismatch.kind === 'gap'
          ? `Gap Q${mismatch.queryAa}`
          : `Mismatch Q${mismatch.queryAa}`,
      strand: args.queryStrand,
      source: 'NCBI BLASTP',
      hspNumber: args.hspIndex + 1,
      queryAa: mismatch.queryAa,
      queryResidue: mismatch.queryResidue,
      subjectResidue: mismatch.subjectResidue,
      description:
        mismatch.kind === 'gap'
          ? `gap at query amino acid ${mismatch.queryAa}`
          : `${mismatch.queryResidue}->${mismatch.subjectResidue} at query amino acid ${mismatch.queryAa}`,
    }))
  })
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
    queryAa: number
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
        queryAa: queryPos,
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
        queryAa: queryPos,
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
    `blast_hit_${index + 1}`
  ).replaceAll(/[^A-Za-z0-9_.-]/g, '_')
  return prefix ? `${prefix}_${id}` : id
}

function hitLabel(
  description: { accession?: string; id?: string; title?: string },
  index: number,
) {
  return description.accession ?? description.id ?? `BLAST hit ${index + 1}`
}

function hspStats(hsp: BlastHsp) {
  const identity = percent(hsp.identity, hsp.align_len)
  const positives = percent(hsp.positive, hsp.align_len)
  return {
    evalue: hsp.evalue,
    bitScore: hsp.bit_score,
    score: hsp.score,
    identity,
    percentIdentity: identity,
    positives,
    percentPositives: positives,
    mismatches:
      hsp.align_len === undefined || hsp.identity === undefined
        ? undefined
        : hsp.align_len - hsp.identity - (hsp.gaps ?? 0),
    gaps: hsp.gaps,
    identicalAminoAcids: hsp.identity,
    positiveAminoAcids: hsp.positive,
    alignmentLengthAa: hsp.align_len,
    alignLength: hsp.align_len,
    queryFrom: hsp.query_from,
    queryTo: hsp.query_to,
    subjectFrom: hsp.hit_from,
    subjectTo: hsp.hit_to,
    mismatchQueryPositions: hsp.query_from
      ? hspMismatchPositions(
          hsp as BlastHsp & Required<Pick<BlastHsp, 'query_from' | 'query_to'>>,
        )
          .map(pos => pos.queryAa)
          .join(', ')
      : undefined,
    description: `identity ${identity}%, e-value ${hsp.evalue ?? 'n/a'}`,
  }
}

function bestHits(
  hits: BlastHit[],
  hitLimit: number,
  queryProteinLength: number,
) {
  const rankedHits = [...hits]
    .filter(hit => hit.hsps.some(hasQueryRange))
    .map(hit => ({
      hit,
      stats: hitRankingStats(hit, queryProteinLength),
    }))
    .sort(compareRankedHits)

  return selectDisplayedHits(rankedHits, hitLimit).map(({ hit }) => hit)
}

function selectDisplayedHits(rankedHits: RankedHit[], hitLimit: number) {
  const selected: RankedHit[] = []
  const selectedHits = new Set<BlastHit>()
  const selectedProductKeys = new Set<string>()
  const selectedSubjectGeneKeys = new Set<string>()

  function add(hit?: RankedHit, allowDuplicateProduct = false) {
    if (
      !hit ||
      selectedHits.has(hit.hit) ||
      selectedSubjectGeneKeys.has(hit.stats.subjectGeneKey) ||
      (!allowDuplicateProduct && selectedProductKeys.has(hit.stats.productKey)) ||
      selected.length >= hitLimit
    ) {
      return
    }
    selectedHits.add(hit.hit)
    selectedProductKeys.add(hit.stats.productKey)
    selectedSubjectGeneKeys.add(hit.stats.subjectGeneKey)
    selected.push(hit)
  }

  add(rankedHits.find(({ stats }) => stats.isLikelyCompleteAnnotatedMatch))
  if (hitLimit > 1) {
    add(rankedHits.find(({ stats }) => stats.isStrongQueryLengthMatch))
  }
  for (const rankedHit of rankedHits) {
    add(rankedHit)
  }
  for (const rankedHit of rankedHits) {
    add(rankedHit, true)
  }

  return selected
}

function limitHsps(
  hsps: (BlastHsp & Required<Pick<BlastHsp, 'query_from' | 'query_to'>>)[],
  hspLimit: number,
) {
  return [...hsps].sort(compareHsps).slice(0, hspLimit)
}

function compareRankedHits(a: RankedHit, b: RankedHit) {
  const aStats = a.stats
  const bStats = b.stats
  const rankingScoreDiff = bStats.rankingScore - aStats.rankingScore
  if (rankingScoreDiff) {
    return rankingScoreDiff
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
  const informativeDescriptionDiff =
    Number(bStats.hasInformativeDescription) -
    Number(aStats.hasInformativeDescription)
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

function bestEvalue(hsps: BlastHsp[]) {
  return Math.min(...hsps.map(hsp => hsp.evalue ?? Number.POSITIVE_INFINITY))
}

function bestBitScore(hsps: BlastHsp[]) {
  return Math.max(...hsps.map(hsp => hsp.bit_score ?? 0))
}

function hitRankingStats(
  hit: BlastHit,
  queryProteinLength: number,
): HitRankingStats {
  const hsps = hit.hsps.filter(hasQueryRange)
  const subjectLength = hit.len ?? 0
  const queryCoverage = queryCoveragePct(hsps, queryProteinLength)
  const identity = weightedPercent(hsps, 'identity')
  const evalue = bestEvalue(hsps)
  const bitScore = bestBitScore(hsps)
  const hasInformativeDescription =
    hit.description?.some(isInformativeDescription) ?? false
  const subjectToQueryLengthRatio = queryProteinLength
    ? Number((subjectLength / queryProteinLength).toFixed(2))
    : 0
  const isLikelyCompleteAnnotatedMatch =
    hasInformativeDescription &&
    subjectToQueryLengthRatio >= 1.2 &&
    queryCoverage >= 50 &&
    identity >= 30 &&
    evalue <= 1e-5
  const isStrongQueryLengthMatch =
    queryCoverage >= 98 &&
    identity >= 90 &&
    subjectToQueryLengthRatio <= 1.25
  const isLongerSubjectMatch =
    queryProteinLength > 0 && subjectLength > queryProteinLength

  return {
    alignedLength: queryCoveredLength(hsps),
    bitScore,
    evalue,
    hasInformativeDescription,
    identity,
    isLongerSubjectMatch,
    isLikelyCompleteAnnotatedMatch,
    isStrongQueryLengthMatch,
    queryCoverage,
    rankingScore: hitRankingScore({
      bitScore,
      hasInformativeDescription,
      identity,
      isLikelyCompleteAnnotatedMatch,
      isStrongQueryLengthMatch,
      queryCoverage,
      subjectToQueryLengthRatio,
    }),
    productKey: productKeyForHit(hit),
    subjectGeneKey: subjectGeneKeyForHit(hit),
    subjectLength,
    subjectToQueryLengthRatio,
  }
}

function hitRankingScore({
  bitScore,
  hasInformativeDescription,
  identity,
  isLikelyCompleteAnnotatedMatch,
  isStrongQueryLengthMatch,
  queryCoverage,
  subjectToQueryLengthRatio,
}: Pick<
  HitRankingStats,
  | 'bitScore'
  | 'hasInformativeDescription'
  | 'identity'
  | 'isLikelyCompleteAnnotatedMatch'
  | 'isStrongQueryLengthMatch'
  | 'queryCoverage'
  | 'subjectToQueryLengthRatio'
>) {
  return (
    (isLikelyCompleteAnnotatedMatch ? 10_000 : 0) +
    (isStrongQueryLengthMatch ? 500 : 0) +
    (hasInformativeDescription ? 1_000 : -300) +
    queryCoverage * 8 +
    identity * 2 +
    bitScore +
    Math.min(subjectToQueryLengthRatio, 5) * 75
  )
}

function candidateClass(stats: HitRankingStats) {
  if (stats.isLongerSubjectMatch) {
    return 'longer subject match'
  }
  if (stats.isLikelyCompleteAnnotatedMatch) {
    return 'likely complete annotated homolog'
  }
  if (stats.isStrongQueryLengthMatch) {
    return 'query-length match'
  }
  return 'alignment match'
}

function weightedPercent(hsps: BlastHsp[], field: 'identity' | 'positive') {
  const numerator = sum(hsps, field)
  const denominator = sum(hsps, 'align_len')
  return percent(numerator, denominator)
}

function queryCoveragePct(hsps: BlastHsp[], queryProteinLength: number) {
  return percent(queryCoveredLength(hsps), queryProteinLength)
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
  return Boolean(title && !isGenericProteinTitle(title))
}

function isGenericProteinTitle(title: string) {
  return /\b(hypothetical|uncharacteri[sz]ed|unnamed protein product|predicted protein|unknown function)\b/i.test(
    title,
  )
}

function productKeyForHit(hit: BlastHit) {
  const descriptions = hit.description ?? []
  const description = displayDescription(descriptions)
  const title = stripOrganismSuffix(description.title ?? '').trim()
  if (!title) {
    return `accession:${description.accession ?? description.id ?? hit.num ?? 'unknown'}`
  }
  if (isGenericProteinTitle(title)) {
    return genericProductKey(title)
  }
  return `product:${normalizeProductTitle(title)}`
}

function subjectGeneKeyForHit(hit: BlastHit) {
  const descriptions = hit.description ?? []
  const description = displayDescription(descriptions)
  const title = normalizeProductTitle(description.title ?? '')
  const organism = normalizeSubjectOrganism(description)
  const accessionStem = normalizeAccessionStem(
    description.accession ?? description.id,
  )

  if (title && organism) {
    return `title-organism:${title}:${organism}`
  }
  if (title && accessionStem) {
    return `title-accession:${title}:${accessionStem}`
  }
  return `accession:${description.accession ?? description.id ?? hit.num ?? 'unknown'}`
}

function normalizeSubjectOrganism(description: BlastHitDescription) {
  if (description.taxid !== undefined) {
    return String(description.taxid)
  }
  if (description.sciname) {
    return description.sciname.trim().toLowerCase()
  }
  const organismMatch = /\[([^\]]+)\]\s*$/.exec(description.title ?? '')
  return organismMatch?.[1]?.trim().toLowerCase()
}

function normalizeAccessionStem(accession?: string) {
  return accession?.replace(/\.\d+$/, '').trim().toLowerCase()
}

function genericProductKey(title: string) {
  if (/\bhypothetical\b/i.test(title)) {
    return 'generic:hypothetical protein'
  }
  if (/\bunnamed\b/i.test(title)) {
    return 'generic:unnamed protein product'
  }
  if (/\buncharacteri[sz]ed\b/i.test(title)) {
    return 'generic:uncharacterized protein'
  }
  if (/\bpredicted\b/i.test(title)) {
    return 'generic:predicted protein'
  }
  return `generic:${normalizeProductTitle(title)}`
}

function stripOrganismSuffix(title: string) {
  return title.replace(/\s+\[[^\]]+\]\s*$/, '')
}

function normalizeProductTitle(title: string) {
  return stripOrganismSuffix(title)
    .replace(/\b(partial|isoform\s+\S+|LOW QUALITY PROTEIN:|PREDICTED:)\b/gi, ' ')
    .replaceAll(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase()
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
