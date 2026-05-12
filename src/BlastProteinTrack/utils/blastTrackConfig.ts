import { readConfObject } from '@jbrowse/core/configuration'
import { getSession } from '@jbrowse/core/util'

import type { LinearGenomeViewModel } from '@jbrowse/plugin-linear-genome-view'

export type BlastTrackProgram = 'blastp' | 'blastn' | 'tblastx'

export interface FromConfigFeature {
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

export interface AppendableBlastTrack {
  name: string
  trackId: string
}

export function addBlastFeatureTrack({
  appendToTrackId,
  assemblyName,
  baseUrl,
  blastProgram,
  features,
  name,
  rid,
  trackId,
  view,
}: {
  appendToTrackId?: string
  assemblyName: string
  baseUrl?: string
  blastProgram?: BlastTrackProgram
  features: FromConfigFeature[]
  name: string
  rid?: string
  trackId: string
  view: LinearGenomeViewModel
}) {
  const session = getSession(view) as unknown as BlastTrackSession
  const linkedFeatures =
    rid && baseUrl
      ? features.map(feature => addBlastResultLink(feature, { baseUrl, rid }))
      : features

  if (appendToTrackId) {
    const existingTrack = findTrackConf({
      session,
      trackId: appendToTrackId,
      view,
    })
    if (existingTrack) {
      const existingFeatures = featuresFromTrack(existingTrack)
      const mergedFeatures = makeUniqueFeatureIds([
        ...existingFeatures,
        ...linkedFeatures,
      ])

      updateTrackAdapter(existingTrack, mergedFeatures)
      reloadVisibleTrack(view, appendToTrackId)
      return
    }
    throw new Error(`Could not find BLAST track to append to: ${appendToTrackId}`)
  }

  session.addTrackConf(
    blastTrackConf({
      assemblyNames: [assemblyName],
      blastProgram,
      features: linkedFeatures,
      name,
      trackId,
    }),
  )

  view.showTrack(trackId)
}

export function getAppendableBlastTracks({
  assemblyName,
  blastProgram,
  view,
}: {
  assemblyName: string
  blastProgram: BlastTrackProgram
  view: LinearGenomeViewModel
}): AppendableBlastTrack[] {
  try {
    const session = getSession(view) as unknown as BlastTrackSession
    return trackConfs({ session, view })
      .filter(track => isAppendableBlastTrack(track, assemblyName, blastProgram))
      .map(track => ({
        name:
          stringConf(track, 'name') ||
          stringConf(track, 'trackId') ||
          'BLAST hits',
        trackId: stringConf(track, 'trackId') || '',
      }))
      .filter(track => track.trackId)
      .reverse()
  } catch {
    return []
  }
}

function blastTrackConf({
  assemblyNames,
  blastProgram,
  features,
  name,
  trackId,
}: {
  assemblyNames: string[]
  blastProgram?: BlastTrackProgram
  features: FromConfigFeature[]
  name: string
  trackId: string
}) {
  return {
    type: 'FeatureTrack',
    trackId,
    name,
    assemblyNames,
    category: ['BLAST'],
    metadata: {
      blastTrack: true,
      ...(blastProgram ? { blastProgram } : {}),
    },
    adapter: {
      type: 'FromConfigAdapter',
      features,
    },
    displays: [
      {
        type: 'LinearBasicDisplay',
        displayId: `${trackId}-LinearBasicDisplay`,
        renderer: {
          type: 'SvgFeatureRenderer',
          showLabels: true,
          showDescriptions: true,
          subfeatureLabels: 'overlay',
          color1:
            "jexl:get(feature,'blastStatus') == 'no_hits' ? '#d99000' : get(feature,'blastStatus') == 'no_report' ? '#7c5cc4' : get(feature,'blastStatus') == 'no_sequence' ? '#5f6368' : get(feature,'blastRole') == 'query' ? '#8a8f98' : get(feature,'type') == 'gap' ? '#d99b00' : get(feature,'type') == 'mismatch' ? '#d62728' : get(feature,'blastCandidateClass') == 'longer subject match' ? '#d99000' : get(feature,'blastCandidateClass') == 'likely complete annotated homolog' ? '#2f8f46' : get(feature,'type') == 'CDS' || get(feature,'type') == 'match_part' ? '#4c78a8' : '#9ecae1'",
          color2:
            "jexl:get(feature,'blastStatus') == 'no_hits' ? '#ffd166' : get(feature,'blastStatus') == 'no_report' ? '#c4b5fd' : get(feature,'blastStatus') == 'no_sequence' ? '#c7c9cc' : get(feature,'blastRole') == 'query' ? '#c1c7cf' : get(feature,'type') == 'gap' ? '#ffe08a' : get(feature,'type') == 'mismatch' ? '#ff9896' : get(feature,'blastCandidateClass') == 'longer subject match' ? '#ffd166' : get(feature,'blastCandidateClass') == 'likely complete annotated homolog' ? '#8fd19e' : get(feature,'type') == 'CDS' || get(feature,'type') == 'match_part' ? '#6baed6' : '#c6dbef'",
          labels: {
            name: "jexl:get(feature,'name') || get(feature,'id')",
            description:
              "jexl:get(feature,'description') || get(feature,'note')",
            descriptionColor: 'blue',
          },
        },
      },
    ],
  }
}

interface BlastTrackSession {
  addTrackConf: (trackConf: Record<string, unknown>) => void
  sessionTracks?: Iterable<TrackConfLike>
  tracks?: Iterable<TrackConfLike>
}

type TrackConfLike = Record<string, unknown> & {
  setSubschema?: (slotName: string, data: Record<string, unknown>) => unknown
}

function trackConfs({
  session,
  view,
}: {
  session: BlastTrackSession
  view: LinearGenomeViewModel
}) {
  const seen = new Set<string>()
  const tracks: TrackConfLike[] = []
  const visibleTrackConfs = view.tracks.map(track => track.configuration)
  for (const source of [
    session.sessionTracks,
    session.tracks,
    visibleTrackConfs,
  ]) {
    if (!source) {
      continue
    }
    for (const track of Array.from(source)) {
      const trackId = stringConf(track, 'trackId')
      if (!trackId || seen.has(trackId)) {
        continue
      }
      seen.add(trackId)
      tracks.push(track)
    }
  }
  return tracks
}

function findTrackConf({
  session,
  trackId,
  view,
}: {
  session: BlastTrackSession
  trackId: string
  view: LinearGenomeViewModel
}) {
  return (
    trackConfs({ session, view }).find(
      track => stringConf(track, 'trackId') === trackId,
    ) ??
    (view.tracks.find(
      track => track.configuration.trackId === trackId,
    )?.configuration as TrackConfLike | undefined)
  )
}

function updateTrackAdapter(track: TrackConfLike, features: FromConfigFeature[]) {
  const adapter = {
    type: 'FromConfigAdapter',
    features,
  }
  if (typeof track.setSubschema === 'function') {
    track.setSubschema('adapter', adapter)
    return
  }
  track.adapter = adapter
}

function reloadVisibleTrack(view: LinearGenomeViewModel, trackId: string) {
  const visibleTrack = view.tracks.find(
    track => track.configuration.trackId === trackId,
  )
  if (!visibleTrack) {
    view.showTrack(trackId)
    return
  }
  for (const display of visibleTrack.displays ?? []) {
    void display.reload?.()
  }
}

function isAppendableBlastTrack(
  track: TrackConfLike,
  assemblyName: string,
  blastProgram: BlastTrackProgram,
) {
  if (stringConf(track, 'type') !== 'FeatureTrack') {
    return false
  }

  const category = arrayConf(track, 'category') ?? []
  const metadata = objectConf(track, 'metadata')
  const name = stringConf(track, 'name').toUpperCase()

  const isBlastTrack =
    metadata?.blastTrack === true ||
    category.includes('BLAST') ||
    name.includes('BLAST')
  const sameProgram =
    metadata?.blastProgram === blastProgram ||
    name.includes(blastProgram.toUpperCase())

  if (!isBlastTrack || !sameProgram) {
    return false
  }

  const assemblyNames = arrayConf(track, 'assemblyNames') ?? []
  if (!assemblyNames.includes(assemblyName)) {
    return false
  }

  const adapter = objectConf(track, 'adapter')
  if (adapter?.type !== 'FromConfigAdapter') {
    return false
  }

  return isBlastTrack && sameProgram
}

function featuresFromTrack(track: TrackConfLike): FromConfigFeature[] {
  const adapter = objectConf(track, 'adapter')
  return Array.isArray(adapter?.features)
    ? (adapter.features as FromConfigFeature[])
    : []
}

function stringConf(track: TrackConfLike, slot: string) {
  const value = readSlot(track, slot)
  return typeof value === 'string' ? value : ''
}

function arrayConf(track: TrackConfLike, slot: string) {
  const value = readSlot(track, slot)
  return Array.isArray(value) ? value.filter(isString) : undefined
}

function objectConf(track: TrackConfLike, slot: string) {
  const value = readSlot(track, slot)
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined
}

function readSlot(track: TrackConfLike, slot: string) {
  try {
    return (
      readConfObject as (
        confObject: unknown,
        slotPath?: string | string[],
      ) => unknown
    )(track, slot)
  } catch {
    return track[slot]
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function makeUniqueFeatureIds(features: FromConfigFeature[]) {
  const seen = new Set<string>()
  return features.map((feature, index) =>
    makeUniqueFeatureId(feature, seen, index),
  )
}

function makeUniqueFeatureId(
  feature: FromConfigFeature,
  seen: Set<string>,
  index: number,
): FromConfigFeature {
  const fallbackId = `${feature.refName}_${feature.start}_${feature.end}_${index + 1}`
  const uniqueId = uniqueFeatureId(String(feature.uniqueId || fallbackId), seen)
  return {
    ...feature,
    uniqueId,
    subfeatures: Array.isArray(feature.subfeatures)
      ? feature.subfeatures.map((subfeature, subIndex) =>
          makeUniqueFeatureId(subfeature as FromConfigFeature, seen, subIndex),
        )
      : feature.subfeatures,
  }
}

function uniqueFeatureId(baseId: string, seen: Set<string>) {
  let nextId = baseId
  let copyNumber = 2
  while (seen.has(nextId)) {
    nextId = `${baseId}_copy_${copyNumber}`
    copyNumber += 1
  }
  seen.add(nextId)
  return nextId
}

export function sanitizeTrackId(value: string) {
  return value.replaceAll(/[^A-Za-z0-9_.-]/g, '_')
}

function addBlastResultLink(
  feature: FromConfigFeature,
  {
    baseUrl,
    rid,
  }: {
    baseUrl: string
    rid: string
  },
): FromConfigFeature {
  return {
    ...feature,
    blastRid: rid,
    blastResultUrl: blastResultUrl({ baseUrl, rid }),
    subfeatures: Array.isArray(feature.subfeatures)
      ? feature.subfeatures.map(subfeature =>
          addBlastResultLink(subfeature as FromConfigFeature, { baseUrl, rid }),
        )
      : feature.subfeatures,
  }
}

function blastResultUrl({
  baseUrl,
  rid,
}: {
  baseUrl: string
  rid: string
}) {
  return `${baseUrl}?CMD=Get&RID=${encodeURIComponent(rid)}`
}
