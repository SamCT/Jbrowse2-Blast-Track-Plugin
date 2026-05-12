import { getConf, readConfObject } from '@jbrowse/core/configuration'
import { getSession } from '@jbrowse/core/util'

import type { AbstractSessionModel, Feature } from '@jbrowse/core/util'
import type { AnyConfigurationModel } from '@jbrowse/core/configuration'
import type { LinearGenomeViewModel } from '@jbrowse/plugin-linear-genome-view'

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

  return [...featuresById.values()].sort(
    (a, b) => (a.get('start') as number) - (b.get('start') as number),
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

function overlapsRegion(feature: Feature, region: SelectedRegion) {
  const start = feature.get('start') as number
  const end = feature.get('end') as number
  const refName = feature.get('refName') as string
  return refName === region.refName && start < region.end && end > region.start
}

function featureKey(feature: Feature) {
  return [
    feature.id(),
    feature.get('refName'),
    feature.get('start'),
    feature.get('end'),
  ].join(':')
}

function readOptionalConf(config: AnyConfigurationModel, path: string) {
  try {
    return readConfObject(config, path)
  } catch {
    return undefined
  }
}
