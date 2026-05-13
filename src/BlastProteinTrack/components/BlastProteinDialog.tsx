import React, { useMemo, useState } from 'react'

import { Dialog, ErrorMessage } from '@jbrowse/core/ui'
import { getContainingView } from '@jbrowse/core/util'
import {
  Button,
  Checkbox,
  DialogActions,
  DialogContent,
  FormControlLabel,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material'

import ProgressDots from './ProgressDots'
import LocalBlastHelp from './LocalBlastHelp'

import { featuresFromBlastHits } from '../utils/blastFeatures'
import {
  addBlastFeatureTrack,
  getAppendableBlastTracks,
  sanitizeTrackId,
} from '../utils/blastTrackConfig'
import { getFeatureName } from '../utils/featureSequence'
import {
  fetchLocalBlastDatabases,
  localBlastDatabaseValue,
  queryLocalBlast,
  selectedLocalBlastDatabase,
  type LocalBlastDatabase,
} from '../utils/localBlast'
import { queryBlast } from '../utils/ncbiBlast'
import { getProteinSequence } from '../utils/proteinFromCds'

import type { AbstractTrackModel, Feature } from '@jbrowse/core/util'
import type { LinearGenomeViewModel } from '@jbrowse/plugin-linear-genome-view'

const blastDatabaseOptions = ['nr', 'nr_cluster_seq'] as const
const blastProgramOptions = ['blastp', 'quick-blastp'] as const
const defaultBlastDatabase = 'nr_cluster_seq'
const defaultBlastProgram = 'blastp'
const defaultHitLimit = 3
const defaultHspLimit = 1
const defaultMinIdentityPercent = 30
const ncbiBlastUrl = 'https://blast.ncbi.nlm.nih.gov/Blast.cgi'

export default function BlastProteinDialog({
  handleClose,
  model,
  feature,
}: {
  handleClose: () => void
  model: AbstractTrackModel
  feature: Feature
}) {
  const view = getContainingView(model) as LinearGenomeViewModel
  const featureName = getFeatureName(feature)
  const assemblyName =
    view.assemblyNames?.[0] ?? feature.get('assemblyName') ?? ''
  const appendableBlastTracks = useMemo(
    () =>
      getAppendableBlastTracks({
        assemblyName,
        blastProgram: 'blastp',
        view,
      }),
    [assemblyName, view],
  )
  const [blastDatabase, setBlastDatabase] = useState<string>(defaultBlastDatabase)
  const [blastProgram, setBlastProgram] =
    useState<(typeof blastProgramOptions)[number]>(defaultBlastProgram)
  const [hitLimit, setHitLimit] = useState(defaultHitLimit)
  const [hspLimit, setHspLimit] = useState(defaultHspLimit)
  const [localBlastDatabases, setLocalBlastDatabases] = useState<
    LocalBlastDatabase[]
  >([])
  const [precomputedBlastTableValue, setPrecomputedBlastTableValue] =
    useState('')
  const [loadingLocalDatabases, setLoadingLocalDatabases] = useState(false)
  const [localAllHits, setLocalAllHits] = useState(false)
  const [minIdentityPercent, setMinIdentityPercent] = useState(
    defaultMinIdentityPercent,
  )
  const [includeGenericDescriptions, setIncludeGenericDescriptions] =
    useState(true)
  const [highlightLongerSubjectProteins, setHighlightLongerSubjectProteins] =
    useState(true)
  const [showMismatchMarkers, setShowMismatchMarkers] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<unknown>()
  const [proteinLength, setProteinLength] = useState<number>()
  const [running, setRunning] = useState(false)
  const [appendToExistingTrack, setAppendToExistingTrack] = useState(false)
  const appendTargetTrack = appendableBlastTracks[0]
  const precomputedBlastTable = selectedLocalBlastDatabase({
    databases: localBlastDatabases,
    value: precomputedBlastTableValue,
  })

  async function loadLocalDatabases() {
    try {
      setLoadingLocalDatabases(true)
      setError(undefined)
      const databases = await fetchLocalBlastDatabases({
        program: 'blastp',
        onProgress: setProgress,
      })
      setLocalBlastDatabases(databases)
      if (!databases.length) {
        throw new Error(
          'No precomputed BLASTP tables are configured for BlastTrack.',
        )
      }
      setPrecomputedBlastTableValue(localBlastDatabaseValue(databases[0]))
      setProgress(`Loaded ${databases.length} precomputed BLASTP table(s).`)
    } catch (e) {
      console.error(e)
      setError(e)
    } finally {
      setLoadingLocalDatabases(false)
    }
  }

  async function runBlast() {
    await runBlastSource('ncbi')
  }

  async function runPrecomputedBlast() {
    await runBlastSource('precomputed')
  }

  async function runBlastSource(source: 'ncbi' | 'precomputed') {
    try {
      setRunning(true)
      setError(undefined)
      const selectedPrecomputedTable =
        source === 'precomputed' ? precomputedBlastTable : undefined
      if (source === 'precomputed' && !selectedPrecomputedTable) {
        throw new Error('Choose a precomputed BLASTP table first.')
      }
      setProgress(`Preparing protein sequence for ${featureName}...`)
      const cleanedSequence = cleanProteinSequence(
        (await getProteinSequence({ feature, view })) ?? '',
      )
      setProteinLength(cleanedSequence.length)
      if (!cleanedSequence) {
        throw new Error(
          'No protein sequence was found on this feature. Add protein_sequence, proteinSequence, translation, or seq to the feature attributes, or wire CDS translation extraction into featureSequence.ts.',
        )
      }
      const sanitizedHitLimit = sanitizeHitLimit(hitLimit)
      const sanitizedHspLimit = sanitizeHspLimit(hspLimit)
      const sanitizedMinIdentityPercent =
        sanitizeMinIdentityPercent(minIdentityPercent)
      const displayedHitLimit =
        selectedPrecomputedTable && localAllHits
          ? Number.POSITIVE_INFINITY
          : sanitizedHitLimit
      const query = `>${featureName}\n${cleanedSequence}`
      const { hits, rid } = selectedPrecomputedTable
        ? await queryLocalBlast({
            allHits: localAllHits,
            queryIds: precomputedBlastQueryIds(feature, featureName),
            query,
            blastDatabase: selectedPrecomputedTable,
            blastProgram: 'blastp',
            hitLimit: sanitizedHitLimit,
            hspLimit: sanitizedHspLimit,
            onProgress: setProgress,
          })
        : await queryBlast({
            query,
            blastDatabase,
            blastProgram,
            hitLimit: sanitizedHitLimit,
            baseUrl: ncbiBlastUrl,
            onProgress: setProgress,
          })
      const resultBlastProgram = selectedPrecomputedTable ? 'blastp' : blastProgram
      const resultSource = selectedPrecomputedTable
        ? 'Precomputed BLASTP'
        : blastProgram === 'quick-blastp'
          ? 'NCBI quick-blastp'
          : 'NCBI BLASTP'
      const blastFeatures = featuresFromBlastHits({
        blastProgram: resultBlastProgram,
        highlightLongerSubjectProteins,
        hspLimit: sanitizedHspLimit,
        hits,
        includeGenericDescriptions,
        idPrefix: sanitizeTrackId(`${feature.id()}_${rid}`),
        minIdentityPercent: sanitizedMinIdentityPercent,
        queryFeature: feature,
        queryProteinLength: cleanedSequence.length,
        hitLimit: displayedHitLimit,
        showMismatchMarkers,
        source: resultSource,
      })
      if (!blastFeatures.length) {
        throw new Error(
          `No BLASTP hits passed the current filters. Try lowering minimum identity below ${sanitizedMinIdentityPercent}% or including hypothetical/uncharacterized hits.`,
        )
      }
      const trackId = sanitizeTrackId(`blastp_${feature.id()}_${rid}`)
      addBlastFeatureTrack({
        appendToTrackId: appendToExistingTrack
          ? appendTargetTrack?.trackId
          : undefined,
        assemblyName,
        baseUrl: selectedPrecomputedTable ? undefined : ncbiBlastUrl,
        blastProgram: 'blastp',
        features: blastFeatures,
        name: selectedPrecomputedTable
          ? `Precomputed BLASTP hits - ${featureName}`
          : `BLASTP hits - ${featureName}`,
        rid,
        trackId,
        view,
      })
      handleClose()
    } catch (e) {
      console.error(e)
      setError(e)
    } finally {
      setRunning(false)
    }
  }

  return (
    <Dialog
      maxWidth="lg"
      title="BLAST protein and load track"
      open
      onClose={handleClose}
    >
      <DialogContent sx={{ width: '48rem', maxWidth: '90vw' }}>
        {error ? <ErrorMessage error={error} /> : null}
        <TextField
          margin="normal"
          select
          label="BLAST database"
          value={blastDatabase}
          onChange={event => {
            const nextDatabase = event.target.value as string
            setBlastDatabase(nextDatabase)
            if (nextDatabase === 'nr_cluster_seq') {
              setBlastProgram('blastp')
            }
          }}
          sx={{ mr: 2, minWidth: 180 }}
        >
          {blastDatabaseOptions.map(option => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          margin="normal"
          select
          label="BLAST program"
          value={blastProgram}
          disabled={blastDatabase === 'nr_cluster_seq'}
          onChange={event => {
            setBlastProgram(
              event.target.value as (typeof blastProgramOptions)[number],
            )
          }}
          sx={{ minWidth: 180 }}
        >
          {blastProgramOptions.map(option => (
            <MenuItem key={option} value={option}>
              {option === 'quick-blastp'
                ? 'quick-blastp (faster NCBI protein BLAST)'
                : 'blastp (standard, slower)'}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          disabled={Boolean(precomputedBlastTable && localAllHits)}
          margin="normal"
          type="number"
          label="Number of matches"
          helperText="Distinct subject proteins to keep for this gene"
          value={hitLimit}
          onChange={event => {
            setHitLimit(Number(event.target.value))
          }}
          sx={{ ml: 2, width: 210 }}
        />
        <TextField
          margin="normal"
          type="number"
          label="Minimum identity (%)"
          helperText="Weighted across the BLASTP hit before rendering"
          value={minIdentityPercent}
          onChange={event => {
            setMinIdentityPercent(Number(event.target.value))
          }}
          sx={{ ml: 2, width: 210 }}
        />
        <TextField
          margin="normal"
          type="number"
          label="Alignment segments"
          helperText="1 = best segment, most sensitive; 3 = looser and may draw less accurate segments"
          value={hspLimit}
          onChange={event => {
            setHspLimit(Number(event.target.value))
          }}
          sx={{ ml: 2, width: 210 }}
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={includeGenericDescriptions}
              onChange={event => {
                setIncludeGenericDescriptions(event.target.checked)
              }}
            />
          }
          label="Include hypothetical/uncharacterized hits"
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={highlightLongerSubjectProteins}
              onChange={event => {
                setHighlightLongerSubjectProteins(event.target.checked)
              }}
            />
          }
          label="Highlight larger subject proteins"
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={showMismatchMarkers}
              onChange={event => {
                setShowMismatchMarkers(event.target.checked)
              }}
            />
          }
          label="Show mismatch/gap ticks"
        />
        {appendTargetTrack ? (
          <FormControlLabel
            control={
              <Checkbox
                checked={appendToExistingTrack}
                onChange={event => {
                  setAppendToExistingTrack(event.target.checked)
                }}
              />
            }
            label={`Append to existing BLASTP track (experimental): ${appendTargetTrack.name}`}
          />
        ) : null}
        <Typography sx={{ mt: 2 }} variant="body2">
          Query feature: {featureName}
        </Typography>
        <Typography variant="body2">
          Protein length:{' '}
          {proteinLength === undefined
            ? 'detected when submitted'
            : `${proteinLength} aa`}
        </Typography>
        <Typography sx={{ mt: 1 }} variant="body2">
          BLASTP protein HSPs will be projected onto CDS exons. Blue blocks are
          aligned HSP segments. Mismatch and gap counts remain available in
          feature details; red mismatch and yellow gap ticks are optional
          because dense alignments can become hard to read.
        </Typography>
        <Typography sx={{ mt: 1 }} variant="body2">
          BlastTrack spaces NCBI BLAST submissions at least 10 seconds apart and
          polls each RID every 30 seconds after the first check.
        </Typography>
        <Typography sx={{ mt: 3 }} variant="subtitle2">
          Precomputed BLASTP table
        </Typography>
        <Button
          disabled={running || loadingLocalDatabases}
          onClick={() => {
            void loadLocalDatabases()
          }}
          sx={{ mt: 1, mr: 1 }}
          variant="outlined"
        >
          Load tables
        </Button>
        <LocalBlastHelp />
        {localBlastDatabases.length ? (
          <TextField
            margin="normal"
            select
            label="Precomputed table"
            value={precomputedBlastTableValue}
            onChange={event => {
              setPrecomputedBlastTableValue(event.target.value)
            }}
            sx={{ ml: 2, minWidth: 260 }}
          >
            {localBlastDatabases.map(database => (
              <MenuItem
                key={database.id}
                value={localBlastDatabaseValue(database)}
              >
                {database.title ?? database.name}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        {precomputedBlastTable ? (
          <FormControlLabel
            control={
              <Checkbox
                checked={localAllHits}
                onChange={event => {
                  setLocalAllHits(event.target.checked)
                }}
              />
            }
            label="All precomputed BLAST hits"
          />
        ) : null}
        <Typography sx={{ mt: 1 }} variant="body2">
          Precomputed tables read static tabix-indexed BLASTP rows by clicked
          query ID; they do not submit a BLAST job.
        </Typography>
        {running ? (
          <ProgressDots message={progress} />
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button
          disabled={running}
          onClick={() => {
            void runBlast()
          }}
          variant="contained"
        >
          Submit NCBI BLAST
        </Button>
        <Button
          disabled={running || !precomputedBlastTable}
          onClick={() => {
            void runPrecomputedBlast()
          }}
          variant="outlined"
        >
          Load Precomputed Hits
        </Button>
        <Button disabled={running} onClick={handleClose}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function sanitizeHitLimit(value: number) {
  if (!Number.isFinite(value)) {
    return defaultHitLimit
  }
  return Math.min(100, Math.max(1, Math.floor(value)))
}

function sanitizeHspLimit(value: number) {
  if (!Number.isFinite(value)) {
    return defaultHspLimit
  }
  return Math.min(100, Math.max(1, Math.floor(value)))
}

function sanitizeMinIdentityPercent(value: number) {
  if (!Number.isFinite(value)) {
    return defaultMinIdentityPercent
  }
  return Math.min(100, Math.max(0, Number(value)))
}

function cleanProteinSequence(sequence: string) {
  return sequence.replaceAll(/[^A-Za-z*]/g, '').toUpperCase()
}

interface QueryIdFeatureJson {
  end?: number
  gene_id?: unknown
  id?: unknown
  name?: unknown
  parent?: unknown
  Parent?: unknown
  protein_id?: unknown
  start?: number
  subfeatures?: QueryIdFeatureJson[]
  transcript_id?: unknown
  type?: string
}

function precomputedBlastQueryIds(feature: Feature, featureName: string) {
  const json = feature.toJSON() as QueryIdFeatureJson
  const bestTranscript = bestTranscriptFeature(json)
  return uniqueStrings(
    uniqueStrings([
      ...idsFromFeatureJson(bestTranscript),
      ...idsFromFeatureJson(json),
      stringValue(featureName),
      stringValue(feature.id()),
      stringValue(feature.get('id')),
      stringValue(feature.get('name')),
      stringValue(feature.get('gene_id')),
      stringValue(feature.get('transcript_id')),
      ...idsFromFeatureJson(...(json.subfeatures ?? [])),
    ]).flatMap(id => idAliases(id)),
  )
}

function bestTranscriptFeature(feature: QueryIdFeatureJson) {
  const candidates = transcriptCandidates(feature)
  return candidates.sort((a, b) => cdsLength(b) - cdsLength(a))[0]
}

function transcriptCandidates(feature: QueryIdFeatureJson): QueryIdFeatureJson[] {
  const subfeatures = feature.subfeatures ?? []
  return [
    ...(feature.type === 'mRNA' || feature.type === 'transcript'
      ? [feature]
      : []),
    ...subfeatures.flatMap(transcriptCandidates),
  ]
}

function cdsLength(feature: QueryIdFeatureJson) {
  return collectCds(feature).reduce(
    (total, cds) => total + Math.max(0, (cds.end ?? 0) - (cds.start ?? 0)),
    0,
  )
}

function collectCds(feature: QueryIdFeatureJson): QueryIdFeatureJson[] {
  return [
    ...(feature.type === 'CDS' ? [feature] : []),
    ...(feature.subfeatures ?? []).flatMap(collectCds),
  ]
}

function idsFromFeatureJson(...features: (QueryIdFeatureJson | undefined)[]) {
  return features.flatMap(feature =>
    feature
      ? [
          stringValue(feature.id),
          stringValue(feature.name),
          stringValue(feature.gene_id),
          stringValue(feature.transcript_id),
          stringValue(feature.protein_id),
          stringValue(feature.Parent),
          stringValue(feature.parent),
        ]
      : [],
  )
}

function idAliases(id: string) {
  const trimmed = id.trim()
  const firstToken = trimmed.split(/\s+/)[0]
  const withoutPrefix = firstToken.replace(
    /^(rna|transcript|mrna|cds|protein)[:-]/i,
    '',
  )
  return uniqueStrings([
    trimmed,
    firstToken,
    withoutPrefix,
    withoutPrefix.replace(/\.(?:p|protein)\d*$/i, ''),
    withoutPrefix.replace(/\.prot$/i, ''),
  ])
}

function stringValue(value: unknown) {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' || typeof first === 'number'
    ? String(first)
    : ''
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}
