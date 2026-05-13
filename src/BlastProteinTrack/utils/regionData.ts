import { getConf, readConfObject } from '@jbrowse/core/configuration'
import { getSession } from '@jbrowse/core/util'

import { extractProteinSequence } from './featureSequence'
import { getBestCdsSet } from './proteinFromCds'

import type { AbstractSessionModel, Feature } from '@jbrowse/core/util'
import type { AnyConfigurationModel } from '@jbrowse/core/configuration'
import type { LinearGenomeViewModel } from '@jbrowse/plugin-linear-genome-view'
import type { JsonFeature } from './proteinFromCds'

export interface SelectedRegion {
  assemblyName: string
  refName: string
  start: number
  end: number
}

interface AssemblyRefNameApi {
  getCanonicalRefName?: (refName: string) => string | undefined
  getCanonicalRefName2?: (refName: string) => string | undefined
  getSeqAdapterRefName?: (refName: string) => string | undefined
}

export async function fetchRegionSequence({
  region,
  view,
}: {
  region: SelectedRegion
  view: LinearGenomeViewModel
}) {
  const session = getSession(view) as AbstractSessionModel
  const assembly = await session.assemblyManager.waitForAssembly(
    region.assemblyName,
  )
  if (!assembly) {
    throw new Error(`Assembly not found: ${region.assemblyName}`)
  }

  const sequenceRefName = getSequenceRefName(assembly, region.refName)
  const sessionId = 'blast-track-region-sequence'
  const features = (await session.rpcManager.call(sessionId, 'CoreGetFeatures', {
    adapterConfig: getConf(assembly, ['sequence', 'adapter']),
    sessionId,
    regions: [
      {
        ...region,
        refName: sequenceRefName,
      },
    ],
  })) as Feature[]

  return features
    .map(feature => feature.get('seq'))
    .filter((seq): seq is string => typeof seq === 'string')
    .join('')
}

function getSequenceRefName(assembly: AssemblyRefNameApi, refName: string) {
  const canonicalRefName =
    callAssemblyRefNameMethod(assembly, 'getCanonicalRefName2', refName) ??
    callAssemblyRefNameMethod(assembly, 'getCanonicalRefName', refName) ??
    refName

  return (
    callAssemblyRefNameMethod(
      assembly,
      'getSeqAdapterRefName',
      canonicalRefName,
    ) ?? canonicalRefName
  )
}

function callAssemblyRefNameMethod(
  assembly: AssemblyRefNameApi,
  method: keyof AssemblyRefNameApi,
  refName: string,
) {
  const mapper = assembly[method]
  if (typeof mapper !== 'function') {
    return undefined
  }
  try {
    return mapper.call(assembly, refName) || undefined
  } catch {
    return undefined
  }
}

export async function fetchBlastableGenes({
  region,
  view,
}: {
  region: SelectedRegion
  view: LinearGenomeViewModel
}) {
  return getRenderedBlastableGenes({ region, view })
}

function getRenderedBlastableGenes({
  region,
  view,
}: {
  region: SelectedRegion
  view: LinearGenomeViewModel
}) {
  const maybeView = view as LinearGenomeViewModel & {
    tracks?: {
      type?: string
      configuration?: AnyConfigurationModel
      displays?: {
        features?: {
          values?: () => Iterable<Feature | undefined>
        }
      }[]
    }[]
  }
  const featuresById = new Map<string, Feature>()

  for (const track of maybeView.tracks ?? []) {
    if (!isRenderedCandidateFeatureTrack(track, region.assemblyName)) {
      continue
    }

    for (const display of track.displays ?? []) {
      const values = display.features?.values
      if (typeof values !== 'function') {
        continue
      }

      for (const feature of values.call(display.features)) {
        if (
          !feature ||
          !isBlastableGeneFeature(feature) ||
          !overlapsRegion(feature, region)
        ) {
          continue
        }
        featuresById.set(featureKey(feature), feature)
      }
    }
  }

  return deduplicateBlastableGenes([...featuresById.values()]).sort(
    compareFeatureStart,
  )
}

function isRenderedCandidateFeatureTrack(
  track: { type?: string; configuration?: AnyConfigurationModel },
  assemblyName: string,
) {
  if (track.type !== 'FeatureTrack' || !track.configuration) {
    return false
  }

  const category = readOptionalConf(track.configuration, 'category')
  if (Array.isArray(category) && category.includes('BLAST')) {
    return false
  }

  const assemblyNames = readOptionalConf(track.configuration, 'assemblyNames') as
    | string[]
    | undefined
  return !assemblyNames?.length || assemblyNames.includes(assemblyName)
}

export function regionLabel(region: SelectedRegion) {
  return `${region.refName}:${region.start + 1}-${region.end}`
}

function isBlastableGeneFeature(feature: Feature) {
  return ['gene', 'mRNA', 'transcript'].includes(feature.get('type') as string)
}

function deduplicateBlastableGenes(features: Feature[]) {
  const sortedFeatures = [...features].sort(compareFeatureStart)
  const geneFeatures = sortedFeatures.filter(
    feature => featureType(feature) === 'gene',
  )
  const representatives = new Map<string, Feature>()

  for (const feature of sortedFeatures) {
    const key = featureGroupKey(feature, geneFeatures)
    const existing = representatives.get(key)
    if (!existing || betterBlastRepresentative(feature, existing)) {
      representatives.set(key, feature)
    }
  }

  return [...representatives.values()]
}

function isTranscriptOfGene(feature: Feature, gene: Feature) {
  if (!containsFeature(gene, feature)) {
    return false
  }

  if (sharesGeneIdentity(feature, gene)) {
    return true
  }

  const parentIds = geneParentIds(feature)
  const geneIds = geneIdentityValues(gene)
  if (parentIds.length && geneIds.length) {
    return parentIds.some(parentId => geneIds.includes(parentId))
  }

  return featureStrand(feature) === featureStrand(gene)
}

function betterBlastRepresentative(candidate: Feature, existing: Feature) {
  const candidateProteinLength = estimatedProteinLength(candidate)
  const existingProteinLength = estimatedProteinLength(existing)
  if (candidateProteinLength !== existingProteinLength) {
    return candidateProteinLength > existingProteinLength
  }

  const candidatePriority = featureTypePriority(candidate)
  const existingPriority = featureTypePriority(existing)
  if (candidatePriority !== existingPriority) {
    return candidatePriority < existingPriority
  }
  return featureLength(candidate) > featureLength(existing)
}

function featureTypePriority(feature: Feature) {
  if (featureType(feature) === 'mRNA') {
    return 0
  }
  if (featureType(feature) === 'transcript') {
    return 1
  }
  return 2
}

function featureGroupKey(feature: Feature, geneFeatures: Feature[]) {
  const containingGene =
    featureType(feature) === 'gene'
      ? undefined
      : geneFeatures.find(gene => isTranscriptOfGene(feature, gene))

  if (containingGene) {
    const identity =
      geneIdentityValues(containingGene)[0] ?? geneParentIds(feature)[0]
    return identity
      ? `${featureRefName(feature)}:${identity}`
      : featureKey(containingGene)
  }

  const identity = geneParentIds(feature)[0] ?? geneIdentityValues(feature)[0]
  return identity
    ? `${featureRefName(feature)}:${identity}`
    : featureKey(feature)
}

function estimatedProteinLength(feature: Feature) {
  const embeddedSequence = extractProteinSequence(feature)
  if (embeddedSequence) {
    return embeddedSequence.replaceAll(/[^A-Za-z*]/g, '').length
  }

  const cds = getBestCdsSet(feature.toJSON() as JsonFeature)
  return Math.floor(
    cds.reduce((total, sub) => total + sub.end - sub.start, 0) / 3,
  )
}

function containsFeature(container: Feature, feature: Feature) {
  return (
    featureRefName(container) === featureRefName(feature) &&
    featureStart(container) <= featureStart(feature) &&
    featureEnd(container) >= featureEnd(feature)
  )
}

function sharesGeneIdentity(a: Feature, b: Feature) {
  const aValues = geneIdentityValues(a)
  const bValues = geneIdentityValues(b)
  return aValues.some(value => bValues.includes(value))
}

function geneParentIds(feature: Feature) {
  return normalizeFeatureValues(
    feature.get('Parent') ??
      feature.get('parent') ??
      feature.get('parents') ??
      feature.get('transcript_parent') ??
      feature.get('gene_id'),
  )
}

function geneIdentityValues(feature: Feature) {
  return [
    ...[
      'ID',
      'id',
      'gene_id',
      'gene_name',
      'locus_tag',
      'Name',
      'name',
    ].flatMap(attribute => normalizeFeatureValues(feature.get(attribute))),
    feature.id(),
  ]
    .map(normalizeFeatureIdentity)
    .filter((value): value is string => Boolean(value))
}

function normalizeFeatureValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(normalizeFeatureValues)
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    return []
  }
  return String(value)
    .split(',')
    .map(normalizeFeatureIdentity)
    .filter((entry): entry is string => Boolean(entry))
}

function normalizeFeatureIdentity(value: unknown) {
  return typeof value === 'string'
    ? value
        .replace(/^(gene|mrna|transcript)[:_-]/i, '')
        .replace(/\.(?:mrna|transcript|t|isoform)\d+$/i, '')
        .trim()
        .toLowerCase()
    : undefined
}

function compareFeatureStart(a: Feature, b: Feature) {
  return featureStart(a) - featureStart(b)
}

function featureType(feature: Feature) {
  return feature.get('type') as string
}

function featureRefName(feature: Feature) {
  return feature.get('refName') as string
}

function featureStart(feature: Feature) {
  return feature.get('start') as number
}

function featureEnd(feature: Feature) {
  return feature.get('end') as number
}

function featureStrand(feature: Feature) {
  return (feature.get('strand') as number | undefined) ?? 0
}

function featureLength(feature: Feature) {
  return featureEnd(feature) - featureStart(feature)
}

function overlapsRegion(feature: Feature, region: SelectedRegion) {
  const start = featureStart(feature)
  const end = featureEnd(feature)
  const refName = featureRefName(feature)
  return refName === region.refName && start < region.end && end > region.start
}

function featureKey(feature: Feature) {
  return [
    feature.id(),
    featureRefName(feature),
    featureStart(feature),
    featureEnd(feature),
  ].join(':')
}

function readOptionalConf(config: AnyConfigurationModel, path: string) {
  try {
    return readConfObject(config, path)
  } catch {
    return undefined
  }
}
