import React, { useEffect, useState } from 'react'

import { Dialog, ErrorMessage } from '@jbrowse/core/ui'
import { getSession } from '@jbrowse/core/util'
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

import { featuresFromBlastHits } from '../utils/blastFeatures'
import { featuresFromBlastNHits } from '../utils/blastNFeatures'
import {
  addBlastFeatureTrack,
  getAppendableBlastTracks,
  sanitizeTrackId,
} from '../utils/blastTrackConfig'
import { getFeatureName } from '../utils/featureSequence'
import { queryBlast, queryBlastReports } from '../utils/ncbiBlast'
import { getProteinSequence } from '../utils/proteinFromCds'
import { queryGeneFeature } from '../utils/queryGeneFeatures'
import {
  fetchBlastableGenes,
  fetchRegionSequence,
  regionLabel,
} from '../utils/regionData'

import type { FromConfigFeature } from '../utils/blastTrackConfig'
import type { BlastQueryReport } from '../utils/ncbiBlast'
import type { SelectedRegion } from '../utils/regionData'
import type { Feature } from '@jbrowse/core/util'
import type { LinearGenomeViewModel } from '@jbrowse/plugin-linear-genome-view'

const proteinDatabaseOptions = ['nr', 'nr_clustered_seq'] as const
const proteinProgramOptions = ['blastp', 'quick-blastp'] as const
const defaultBlastnHitLimit = 5
const defaultBatchHitLimit = 3
const defaultHspLimit = 3
const defaultMaxGenes = 10
const defaultMaxRegionBp = 50_000
const highVolumeGeneWarningThreshold = 10
const ncbiBlastUrl = 'https://blast.ncbi.nlm.nih.gov/Blast.cgi'

export type SelectionBlastMode = 'blastn-region' | 'blastp-genes'

export default function BlastSelectionDialog({
  handleClose,
  mode,
  model,
  regions,
}: {
  handleClose: () => void
  mode: SelectionBlastMode
  model: LinearGenomeViewModel
  regions: SelectedRegion[]
}) {
  const appendBlastProgram = mode === 'blastn-region' ? 'blastn' : 'blastp'
  const appendableBlastTracks =
    regions.length === 1
      ? getAppendableBlastTracks({
          assemblyName: regions[0].assemblyName,
          blastProgram: appendBlastProgram,
          view: model,
        })
      : []
  const [blastDatabase, setBlastDatabase] = useState(
    mode === 'blastn-region' ? 'nt' : 'nr',
  )
  const [blastProgram, setBlastProgram] =
    useState<(typeof proteinProgramOptions)[number]>('quick-blastp')
  const [hitLimit, setHitLimit] = useState(
    mode === 'blastn-region' ? defaultBlastnHitLimit : defaultBatchHitLimit,
  )
  const [hspLimit, setHspLimit] = useState(defaultHspLimit)
  const [showMismatchMarkers, setShowMismatchMarkers] = useState(false)
  const [maxGenes, setMaxGenes] = useState(defaultMaxGenes)
  const [maxRegionBp, setMaxRegionBp] = useState(defaultMaxRegionBp)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<unknown>()
  const [running, setRunning] = useState(false)
  const [appendToExistingTrack, setAppendToExistingTrack] = useState(
    appendableBlastTracks.length > 0,
  )
  const [appendChoiceTouched, setAppendChoiceTouched] = useState(false)
  const appendTargetTrack = appendableBlastTracks[0]

  const title =
    mode === 'blastn-region'
      ? 'BLASTN selected region'
      : 'BLASTP genes in selected region'
  const regionText =
    regions.length === 1
      ? regionLabel(regions[0])
      : `${regions.length} selected regions`

  useEffect(() => {
    if (appendTargetTrack && !appendChoiceTouched) {
      setAppendToExistingTrack(true)
    }
  }, [appendChoiceTouched, appendTargetTrack?.trackId])

  async function runBlast() {
    try {
      setRunning(true)
      setError(undefined)
      if (mode === 'blastn-region') {
        await runBlastnRegion()
      } else {
        await runBlastpGenes()
      }
      handleClose()
    } catch (e) {
      console.error(e)
      setError(e)
    } finally {
      setRunning(false)
    }
  }

  async function runBlastnRegion() {
    const region = getSingleRegion(regions)
    const regionLength = region.end - region.start
    const sanitizedMaxRegionBp = sanitizeMaxRegionBp(maxRegionBp)
    if (regionLength > sanitizedMaxRegionBp) {
      throw new Error(
        `Selected region is ${regionLength.toLocaleString()} bp. Increase "Max region bp" to submit the whole region.`,
      )
    }

    setProgress(`Fetching sequence for ${regionLabel(region)}...`)
    const sequence = cleanNucleotideSequence(
      await fetchRegionSequence({ region, view: model }),
    )
    if (!sequence) {
      throw new Error(`No reference sequence was found for ${regionLabel(region)}`)
    }

    const sanitizedHitLimit = sanitizeHitLimit(hitLimit, defaultBlastnHitLimit)
    const sanitizedHspLimit = sanitizeHspLimit(hspLimit)
    const { hits, rid } = await queryBlast({
      query: fastaRecord(regionLabel(region), sequence),
      blastDatabase,
      blastProgram: 'blastn',
      hitLimit: sanitizedHitLimit,
      baseUrl: ncbiBlastUrl,
      onProgress: setProgress,
    })
    const features = featuresFromBlastNHits({
      hitLimit: sanitizedHitLimit,
      hspLimit: sanitizedHspLimit,
      hits,
      idPrefix: sanitizeTrackId(
        `region_${region.refName}_${region.start}_${rid}`,
      ),
      queryLength: sequence.length,
      region,
      showMismatchMarkers,
    })
    if (!features.length) {
      throw new Error('NCBI BLASTN completed, but no alignments were mapped')
    }

    addBlastFeatureTrack({
      appendToTrackId: appendToExistingTrack
        ? appendTargetTrack?.trackId
        : undefined,
      assemblyName: region.assemblyName,
      baseUrl: ncbiBlastUrl,
      blastProgram: 'blastn',
      features,
      name: `BLASTN hits - ${regionLabel(region)}`,
      rid,
      trackId: sanitizeTrackId(
        `blastn_${region.refName}_${region.start}_${region.end}_${rid}`,
      ),
      view: model,
    })
  }

  async function runBlastpGenes() {
    const region = getSingleRegion(regions)
    const sanitizedMaxGenes = sanitizeMaxGenes(maxGenes)
    const sanitizedHitLimit = sanitizeHitLimit(hitLimit, defaultBatchHitLimit)
    const sanitizedHspLimit = sanitizeHspLimit(hspLimit)
    const runPrefix = sanitizeTrackId(
      `run_${Date.now()}_${region.refName}_${region.start}`,
    )

    setProgress(`Finding genes in ${regionLabel(region)}...`)
    const genes = await fetchBlastableGenes({ region, view: model })
    if (!genes.length) {
      throw new Error(
        `No visible gene, mRNA, or transcript features found in ${regionLabel(region)}. Zoom in until the gene track is rendered, then run BLASTP genes in selection again.`,
      )
    }

    const selectedGenes = genes.slice(0, sanitizedMaxGenes)
    if (selectedGenes.length >= highVolumeGeneWarningThreshold) {
      getSession(model).notify(
        `Submitting ${selectedGenes.length} genes as one multi-FASTA BLASTP request. NCBI may slow high-volume use; BlastTrack spaces new submissions by at least 10 seconds and polls RIDs once per minute.`,
        'warning',
      )
    }
    const queries: {
      feature: Feature
      header: string
      idPrefix: string
      name: string
      sequence: string
    }[] = []
    const noSequenceFeatures: FromConfigFeature[] = []

    for (const [index, feature] of selectedGenes.entries()) {
      const name = String(getFeatureName(feature))
      const idPrefix = sanitizeTrackId(`${runPrefix}_gene_${index + 1}_${name}`)
      setProgress(
        `Translating gene ${index + 1}/${selectedGenes.length}: ${name}`,
      )
      let sequence = ''
      try {
        sequence = cleanProteinSequence(
          (await getProteinSequence({ feature, view: model })) ?? '',
        )
      } catch (e) {
        noSequenceFeatures.push(
          queryGeneFeature({
            feature,
            hitCount: 0,
            idPrefix,
            status: 'no_sequence',
            statusDetail: `sequence fetch failed: ${errorMessage(e)}`,
          }),
        )
        continue
      }
      if (sequence) {
        queries.push({
          feature,
          header: sanitizeFastaHeader(`gene_${index + 1}_${name}`),
          idPrefix,
          name,
          sequence,
        })
      } else {
        noSequenceFeatures.push(
          queryGeneFeature({
            feature,
            hitCount: 0,
            idPrefix,
            status: 'no_sequence',
          }),
        )
      }
    }

    if (!queries.length) {
      addBlastFeatureTrack({
        appendToTrackId: appendToExistingTrack
          ? appendTargetTrack?.trackId
          : undefined,
        assemblyName: region.assemblyName,
        blastProgram: 'blastp',
        features: noSequenceFeatures,
        name: `BLASTP gene hits - ${regionLabel(region)}`,
        trackId: sanitizeTrackId(
          `blastp_genes_no_sequence_${region.refName}_${region.start}_${region.end}_${Date.now()}`,
        ),
        view: model,
      })
      getSession(model).notify(
        'Genes were found, but none had extractable CDS/protein sequence for BLASTP. Query markers were added to the BLAST track.',
        'warning',
      )
      return
    }

    const { reports, rid } = await queryBlastReports({
      query: queries
        .map(({ header, sequence }) => fastaRecord(header, sequence))
        .join('\n'),
      blastDatabase,
      blastProgram,
      hitLimit: sanitizedHitLimit,
      baseUrl: ncbiBlastUrl,
      onProgress: message => {
        setProgress(`BLASTP ${queries.length} genes: ${message}`)
      },
    })

    const hitFeaturesByGene = new Map<Feature, FromConfigFeature[]>()
    const reportMatchesByGene = new Map<Feature, QueryReportMatch>()
    const hitFeatures = queries.flatMap(({ feature, header, idPrefix, sequence }, index) => {
      const reportMatch = reportForQuery({
        fallbackIndex: index,
        header,
        queryCount: queries.length,
        reports,
      })
      reportMatchesByGene.set(feature, reportMatch)
      const renderedHits = featuresFromBlastHits({
        hitLimit: sanitizedHitLimit,
        hspLimit: sanitizedHspLimit,
        hits: reportMatch.report?.hits ?? [],
        idPrefix,
        queryFeature: feature,
        queryProteinLength: sequence.length,
        showMismatchMarkers,
      })
      hitFeaturesByGene.set(feature, renderedHits)
      return renderedHits
    }) as FromConfigFeature[]

    const queryStatusFeatures = queries.flatMap(({ feature, idPrefix }) => {
      const renderedHits = hitFeaturesByGene.get(feature) ?? []
      const reportMatch = reportMatchesByGene.get(feature)
      if (renderedHits.length) {
        return []
      }
      const status = reportMatch?.report ? 'no_hits' : 'no_report'
      return [
        queryGeneFeature({
          feature,
          hitCount: 0,
          idPrefix,
          reportMatchedBy: reportMatch?.matchedBy,
          reportQueryId: reportMatch?.report?.queryId,
          reportQueryTitle: reportMatch?.report?.queryTitle,
          status,
        }),
      ]
    })
    const features = [
      ...queryStatusFeatures,
      ...noSequenceFeatures,
      ...hitFeatures,
    ]

    addBlastFeatureTrack({
      appendToTrackId: appendToExistingTrack
        ? appendTargetTrack?.trackId
        : undefined,
      assemblyName: region.assemblyName,
      baseUrl: ncbiBlastUrl,
      blastProgram: 'blastp',
      features,
      name: `BLASTP gene hits - ${regionLabel(region)}`,
      rid,
      trackId: sanitizeTrackId(
        `blastp_genes_${region.refName}_${region.start}_${region.end}_${rid}`,
      ),
      view: model,
    })

    const skippedByLimit = genes.length - selectedGenes.length
    const skippedNoSequence = selectedGenes.length - queries.length
    const submittedWithoutHits = queryStatusFeatures.filter(
      feature => feature.blastStatus === 'no_hits',
    ).length
    const submittedWithoutMatchedReport = queryStatusFeatures.filter(
      feature => feature.blastStatus === 'no_report',
    ).length
    if (
      skippedByLimit ||
      skippedNoSequence ||
      submittedWithoutHits ||
      submittedWithoutMatchedReport
    ) {
      getSession(model).notify(
        [
          skippedByLimit
            ? `${skippedByLimit} genes skipped by the max-gene limit`
            : '',
          skippedNoSequence
            ? `${skippedNoSequence} genes marked without CDS/protein sequence`
            : '',
          submittedWithoutHits
            ? `${submittedWithoutHits} submitted genes had no BLAST hits`
            : '',
          submittedWithoutMatchedReport
            ? `${submittedWithoutMatchedReport} submitted genes could not be matched to an NCBI report`
            : '',
        ]
          .filter(Boolean)
          .join('; '),
        'warning',
      )
    }
  }

  return (
    <Dialog maxWidth="lg" title={title} open onClose={handleClose}>
      <DialogContent sx={{ width: '48rem', maxWidth: '90vw' }}>
        {error ? <ErrorMessage error={error} /> : null}
        {mode === 'blastp-genes' ? (
          <>
            <TextField
              margin="normal"
              select
              label="BLAST database"
              value={blastDatabase}
              onChange={event => {
                const nextDatabase = event.target.value
                setBlastDatabase(nextDatabase)
                if (nextDatabase === 'nr_clustered_seq') {
                  setBlastProgram('blastp')
                }
              }}
              sx={{ mr: 2, minWidth: 180 }}
            >
              {proteinDatabaseOptions.map(option => (
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
              disabled={blastDatabase === 'nr_clustered_seq'}
              onChange={event => {
                setBlastProgram(
                  event.target.value as (typeof proteinProgramOptions)[number],
                )
              }}
              sx={{ minWidth: 180 }}
            >
              {proteinProgramOptions.map(option => (
                <MenuItem key={option} value={option}>
                  {option === 'quick-blastp'
                    ? 'quick-blastp (faster NCBI protein BLAST)'
                    : 'blastp (standard, slower)'}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              margin="normal"
              type="number"
              label="Max genes"
              value={maxGenes}
              onChange={event => {
                setMaxGenes(Number(event.target.value))
              }}
              sx={{ ml: 2, width: 120 }}
            />
          </>
        ) : (
          <>
            <TextField
              margin="normal"
              label="BLAST database"
              value={blastDatabase}
              onChange={event => {
                setBlastDatabase(event.target.value)
              }}
              sx={{ mr: 2, minWidth: 180 }}
            />
            <TextField
              margin="normal"
              type="number"
              label="Max region bp"
              value={maxRegionBp}
              onChange={event => {
                setMaxRegionBp(Number(event.target.value))
              }}
              sx={{ width: 150 }}
            />
          </>
        )}
        <TextField
          margin="normal"
          type="number"
          label={
            mode === 'blastp-genes'
              ? 'Matches per gene'
              : 'Number of matches'
          }
          value={hitLimit}
          onChange={event => {
            setHitLimit(Number(event.target.value))
          }}
          sx={{ ml: 2, width: 130 }}
        />
        <TextField
          margin="normal"
          type="number"
          label="Segments per match"
          value={hspLimit}
          onChange={event => {
            setHspLimit(Number(event.target.value))
          }}
          sx={{ ml: 2, width: 140 }}
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
                  setAppendChoiceTouched(true)
                  setAppendToExistingTrack(event.target.checked)
                }}
              />
            }
            label={`Append to existing ${appendBlastProgram.toUpperCase()} track (experimental): ${
              appendTargetTrack.name
            }`}
          />
        ) : null}
        <Typography sx={{ mt: 2 }} variant="body2">
          Selection: {regionText}
        </Typography>
        <Typography sx={{ mt: 1 }} variant="body2">
          {mode === 'blastp-genes'
            ? 'A single multi-FASTA BLASTP request will be submitted for the selected genes. Hits are drawn over each query gene CDS.'
            : 'The selected reference sequence will be submitted to blastn. HSPs are drawn over the selected genomic span.'}
        </Typography>
        <Typography sx={{ mt: 1 }} variant="body2">
          Mismatch and gap counts are kept in feature details. Red per-position
          ticks are optional because dense alignments can be difficult to read.
        </Typography>
        <Typography sx={{ mt: 1 }} variant="body2">
          BlastTrack batches selected genes into one multi-FASTA request, spaces
          NCBI submissions at least 10 seconds apart, and polls each RID once
          per minute.
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
          Submit
        </Button>
        <Button disabled={running} onClick={handleClose}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function getSingleRegion(regions: SelectedRegion[]) {
  if (regions.length !== 1) {
    throw new Error(
      `BLAST currently supports one continuous selected region; this selection contains ${regions.length}.`,
    )
  }
  const region = regions[0]
  if (region.end <= region.start) {
    throw new Error('Selected region has no length')
  }
  return region
}

function sanitizeHitLimit(value: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.min(100, Math.max(1, Math.floor(value)))
}

function sanitizeMaxGenes(value: number) {
  if (!Number.isFinite(value)) {
    return defaultMaxGenes
  }
  return Math.min(100, Math.max(1, Math.floor(value)))
}

function sanitizeHspLimit(value: number) {
  if (!Number.isFinite(value)) {
    return defaultHspLimit
  }
  return Math.min(100, Math.max(1, Math.floor(value)))
}

function sanitizeMaxRegionBp(value: number) {
  if (!Number.isFinite(value)) {
    return defaultMaxRegionBp
  }
  return Math.min(1_000_000, Math.max(1, Math.floor(value)))
}

function cleanProteinSequence(sequence: string) {
  return sequence.replaceAll(/[^A-Za-z*]/g, '').toUpperCase()
}

function cleanNucleotideSequence(sequence: string) {
  return sequence.replaceAll(/[^A-Za-z]/g, '').toUpperCase()
}

function fastaRecord(header: string, sequence: string) {
  return `>${sanitizeFastaHeader(header)}\n${wrapSequence(sequence)}`
}

function sanitizeFastaHeader(header: string) {
  return sanitizeTrackId(header).slice(0, 120) || 'query'
}

interface QueryReportMatch {
  matchedBy?: 'query_id' | 'query_title' | 'response_order'
  report?: BlastQueryReport
}

function reportForQuery({
  fallbackIndex,
  header,
  queryCount,
  reports,
}: {
  fallbackIndex: number
  header: string
  queryCount: number
  reports: BlastQueryReport[]
}): QueryReportMatch {
  const normalizedHeader = normalizeReportId(header)
  const queryIdMatch = reports.find(
    report => normalizeReportId(report.queryId) === normalizedHeader,
  )
  if (queryIdMatch) {
    return { matchedBy: 'query_id', report: queryIdMatch }
  }

  const queryTitleMatch = reports.find(report => {
    const normalizedTitle = normalizeReportId(report.queryTitle)
    if (!normalizedTitle) {
      return false
    }
    return (
      normalizedTitle === normalizedHeader ||
      normalizedTitle.startsWith(`${normalizedHeader}_`) ||
      normalizedTitle.includes(`_${normalizedHeader}_`)
    )
  })
  if (queryTitleMatch) {
    return { matchedBy: 'query_title', report: queryTitleMatch }
  }

  if (reports.length === queryCount) {
    return { matchedBy: 'response_order', report: reports[fallbackIndex] }
  }

  return {}
}

function normalizeReportId(value?: string) {
  return value?.replaceAll(/[^A-Za-z0-9]+/g, '_').replaceAll(/^_+|_+$/g, '')
}

function wrapSequence(sequence: string) {
  return sequence.match(/.{1,60}/g)?.join('\n') ?? sequence
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
