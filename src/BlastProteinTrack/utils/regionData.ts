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

  const canonicalRefName = assembly.getCanonicalRefName2(region.refName)
  const sessionId = 'blast-track-region-sequence'
  const features = (await session.rpcManager.call(sessionId, 'CoreGetFeatures', {
    adapterConfig: getConf(assembly, ['sequence', 'adapter']),
    sessionId,
    regions: [
      {
        ...region,
        refName: assembly.getSeqAdapterRefName(canonicalRefName),
      },
    ],
  })) as Feature[]

  return features
    .map(feature => feature.get('seq'))
    .filter((seq): seq is string => typeof seq === 'string')
    .join('')
}

export async function fetchBlastableGenes({
  region,
  view,
}: {
  region: SelectedRegion
  view: LinearGenomeViewModel
}) {
  const session = getSession(view) as AbstractSessionModel
  const trackConfs = getTrackConfs(session)
  const featuresById = new Map<string, Feature>()

  for (const trackConf of trackConfs) {
    if (!isCandidateFeatureTrack(trackConf, region.assemblyName)) {
      continue
    }

    const adapterConfig = readConfObject(trackConf, 'adapter')
    const sessionId = `blast-track-region-features-${readConfObject(
      trackConf,
      'trackId',
    )}`
    const features = (await session.rpcManager.call(sessionId, 'CoreGetFeatures', {
      adapterConfig,
      sessionId,
      regions: [region],
    })) as Feature[]

    for (const feature of features) {
      if (!isBlastableGeneFeature(feature) || !overlapsRegion(feature, region)) {
        continue
      }
      featuresById.set(featureKey(feature), feature)
    }
  }

  return [...featuresById.values()].sort(
    (a, b) => (a.get('start') as number) - (b.get('start') as number),
  )
}

function getTrackConfs(session: AbstractSessionModel) {
  const maybeSession = session as AbstractSessionModel & {
    jbrowse?: {
      assemblies?: AnyConfigurationModel[]
      tracks?: AnyConfigurationModel[]
    }
    sessionTracks?: AnyConfigurationModel[]
    temporaryAssemblies?: AnyConfigurationModel[]
    connectionInstances?: { tracks?: AnyConfigurationModel[] }[]
  }

  const assemblies = (maybeSession.jbrowse?.assemblies ??
    []) as { sequence?: AnyConfigurationModel }[]
  const temporaryAssemblies = (maybeSession.temporaryAssemblies ??
    []) as { sequence?: AnyConfigurationModel }[]

  return [
    ...(maybeSession.jbrowse?.tracks ?? []),
    ...(maybeSession.sessionTracks ?? []),
    ...assemblies.flatMap(assembly => assembly.sequence ?? []),
    ...temporaryAssemblies.flatMap(assembly => assembly.sequence ?? []),
    ...(maybeSession.connectionInstances ?? []).flatMap(
      connection => connection.tracks ?? [],
    ),
  ]
}

export function regionLabel(region: SelectedRegion) {
  return `${region.refName}:${region.start + 1}-${region.end}`
}

function isCandidateFeatureTrack(
  trackConf: AnyConfigurationModel,
  assemblyName: string,
) {
  if (readConfObject(trackConf, 'type') !== 'FeatureTrack') {
    return false
  }

  const adapterConfig = readConfObject(trackConf, 'adapter')
  if (!adapterConfig || adapterConfig.type === 'FromConfigAdapter') {
    return false
  }

  const category = readConfObject(trackConf, 'category')
  if (Array.isArray(category) && category.includes('BLAST')) {
    return false
  }

  const assemblyNames = readConfObject(trackConf, 'assemblyNames') as
    | string[]
    | undefined
  return !assemblyNames?.length || assemblyNames.includes(assemblyName)
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
