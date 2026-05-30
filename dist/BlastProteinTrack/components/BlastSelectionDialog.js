import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { Dialog, ErrorMessage } from '@jbrowse/core/ui';
import { getSession } from '@jbrowse/core/util';
import { Button, Checkbox, DialogActions, DialogContent, FormControlLabel, MenuItem, TextField, Typography, } from '@mui/material';
import ProgressDots from './ProgressDots';
import LocalBlastHelp from './LocalBlastHelp';
import { featuresFromBlastHits } from '../utils/blastFeatures';
import { featuresFromBlastNHits } from '../utils/blastNFeatures';
import { addBlastFeatureTrack, getAppendableBlastTracks, sanitizeTrackId, } from '../utils/blastTrackConfig';
import { getFeatureName } from '../utils/featureSequence';
import { fetchLocalBlastDatabases, localBlastDatabaseValue, queryLocalBlastReports, selectedLocalBlastDatabase, } from '../utils/localBlast';
import { queryBlast } from '../utils/ncbiBlast';
import { getProteinSequence } from '../utils/proteinFromCds';
import { queryGeneFeature } from '../utils/queryGeneFeatures';
import { fetchBlastableGenes, fetchRegionSequence, regionLabel, } from '../utils/regionData';
const proteinDatabaseOptions = ['nr', 'nr_cluster_seq'];
const proteinProgramOptions = ['blastp', 'quick-blastp'];
const defaultProteinDatabase = 'nr_cluster_seq';
const defaultProteinProgram = 'blastp';
const defaultBlastnHitLimit = 5;
const defaultBatchHitLimit = 3;
const defaultHspLimit = 1;
const defaultMinIdentityPercent = 30;
const defaultMaxRegionBp = 50_000;
const highVolumeGeneWarningThreshold = 10;
const ncbiBlastUrl = 'https://blast.ncbi.nlm.nih.gov/Blast.cgi';
export default function BlastSelectionDialog({ handleClose, mode, model, regions, }) {
    const isRegionBlast = mode === 'blastn-region' || mode === 'tblastx-region';
    const regionBlastProgram = mode === 'tblastx-region' ? 'tblastx' : 'blastn';
    const appendBlastProgram = isRegionBlast ? regionBlastProgram : 'blastp';
    const appendAssemblyName = regions.length === 1 ? regions[0].assemblyName : '';
    const appendableBlastTracks = useMemo(() => appendAssemblyName
        ? getAppendableBlastTracks({
            assemblyName: appendAssemblyName,
            blastProgram: appendBlastProgram,
            view: model,
        })
        : [], [appendAssemblyName, appendBlastProgram, model]);
    const [blastDatabase, setBlastDatabase] = useState(isRegionBlast ? 'nt' : defaultProteinDatabase);
    const [blastProgram, setBlastProgram] = useState(defaultProteinProgram);
    const [hitLimit, setHitLimit] = useState(isRegionBlast ? defaultBlastnHitLimit : defaultBatchHitLimit);
    const [hspLimit, setHspLimit] = useState(defaultHspLimit);
    const [localBlastDatabases, setLocalBlastDatabases] = useState([]);
    const [precomputedBlastTableValue, setPrecomputedBlastTableValue] = useState('');
    const [loadingLocalDatabases, setLoadingLocalDatabases] = useState(false);
    const [localAllHits, setLocalAllHits] = useState(false);
    const [minIdentityPercent, setMinIdentityPercent] = useState(defaultMinIdentityPercent);
    const [includeGenericDescriptions, setIncludeGenericDescriptions] = useState(true);
    const [highlightLongerSubjectProteins, setHighlightLongerSubjectProteins] = useState(true);
    const [showMismatchMarkers, setShowMismatchMarkers] = useState(false);
    const [maxRegionBp, setMaxRegionBp] = useState(defaultMaxRegionBp);
    const [progress, setProgress] = useState('');
    const [error, setError] = useState();
    const [running, setRunning] = useState(false);
    const [appendToExistingTrack, setAppendToExistingTrack] = useState(false);
    const appendTargetTrack = appendableBlastTracks[0];
    const precomputedBlastTable = selectedLocalBlastDatabase({
        databases: localBlastDatabases,
        value: precomputedBlastTableValue,
    });
    const title = mode === 'blastp-genes'
        ? 'BLASTP genes in selected region'
        : mode === 'tblastx-region'
            ? 'TBLASTX selected region'
            : 'BLASTN selected region';
    const regionText = regions.length === 1
        ? regionLabel(regions[0])
        : `${regions.length} selected regions`;
    async function runBlast() {
        try {
            setRunning(true);
            setError(undefined);
            if (isRegionBlast) {
                await runNucleotideRegionBlast(regionBlastProgram);
            }
            else {
                await runBlastpGenes('ncbi');
            }
            handleClose();
        }
        catch (e) {
            console.error(e);
            setError(e);
        }
        finally {
            setRunning(false);
        }
    }
    async function runPrecomputedBlastpGenes() {
        try {
            setRunning(true);
            setError(undefined);
            if (!precomputedBlastTable) {
                throw new Error('Choose a precomputed BLASTP table first.');
            }
            await runBlastpGenes('precomputed');
            handleClose();
        }
        catch (e) {
            console.error(e);
            setError(e);
        }
        finally {
            setRunning(false);
        }
    }
    async function loadLocalDatabases() {
        try {
            setLoadingLocalDatabases(true);
            setError(undefined);
            const databases = await fetchLocalBlastDatabases({
                program: 'blastp',
                onProgress: setProgress,
            });
            setLocalBlastDatabases(databases);
            if (!databases.length) {
                throw new Error('No precomputed BLASTP tables are configured for BlastTrack.');
            }
            setPrecomputedBlastTableValue(localBlastDatabaseValue(databases[0]));
            setProgress(`Loaded ${databases.length} precomputed BLASTP table(s).`);
        }
        catch (e) {
            console.error(e);
            setError(e);
        }
        finally {
            setLoadingLocalDatabases(false);
        }
    }
    async function runNucleotideRegionBlast(program) {
        const region = getSingleRegion(regions);
        const regionLength = region.end - region.start;
        const sanitizedMaxRegionBp = sanitizeMaxRegionBp(maxRegionBp);
        if (regionLength > sanitizedMaxRegionBp) {
            throw new Error(`Selected region is ${regionLength.toLocaleString()} bp. Increase "Max region bp" to submit the whole region.`);
        }
        setProgress(`Fetching sequence for ${regionLabel(region)}...`);
        const sequence = cleanNucleotideSequence(await fetchRegionSequence({ region, view: model }));
        if (!sequence) {
            throw new Error(`No reference sequence was found for ${regionLabel(region)}`);
        }
        const sanitizedHitLimit = sanitizeHitLimit(hitLimit, defaultBlastnHitLimit);
        const sanitizedHspLimit = sanitizeHspLimit(hspLimit);
        const { hits, rid } = await queryBlast({
            query: fastaRecord(regionLabel(region), sequence),
            blastDatabase,
            blastProgram: program,
            hitLimit: sanitizedHitLimit,
            baseUrl: ncbiBlastUrl,
            onProgress: setProgress,
        });
        const features = featuresFromBlastNHits({
            hitLimit: sanitizedHitLimit,
            hspLimit: sanitizedHspLimit,
            hits,
            idPrefix: sanitizeTrackId(`${program}_region_${region.refName}_${region.start}_${rid}`),
            blastProgram: program,
            queryLength: sequence.length,
            region,
            showMismatchMarkers,
        });
        if (!features.length) {
            throw new Error(`NCBI ${program.toUpperCase()} completed, but no alignments were mapped`);
        }
        addBlastFeatureTrack({
            appendToTrackId: appendToExistingTrack
                ? appendTargetTrack?.trackId
                : undefined,
            assemblyName: region.assemblyName,
            baseUrl: ncbiBlastUrl,
            blastProgram: program,
            features,
            name: `${program.toUpperCase()} hits - ${regionLabel(region)}`,
            rid,
            trackId: sanitizeTrackId(`${program}_${region.refName}_${region.start}_${region.end}_${rid}`),
            view: model,
        });
    }
    async function runBlastpGenes(source) {
        const selectedPrecomputedTable = source === 'precomputed' ? precomputedBlastTable : undefined;
        const region = getSingleRegion(regions);
        const sanitizedHitLimit = sanitizeHitLimit(hitLimit, defaultBatchHitLimit);
        const sanitizedHspLimit = sanitizeHspLimit(hspLimit);
        const sanitizedMinIdentityPercent = sanitizeMinIdentityPercent(minIdentityPercent);
        const displayedHitLimit = selectedPrecomputedTable && localAllHits
            ? Number.POSITIVE_INFINITY
            : sanitizedHitLimit;
        const runPrefix = sanitizeTrackId(`run_${Date.now()}_${region.refName}_${region.start}`);
        setProgress(`Finding genes in ${regionLabel(region)}...`);
        const genes = await fetchBlastableGenes({ region, view: model });
        if (!genes.length) {
            throw new Error(`No visible gene, mRNA, or transcript features found in ${regionLabel(region)}. Zoom in until the gene track is rendered, then run BLASTP genes in selection again.`);
        }
        const selectedGenes = genes;
        if (!selectedPrecomputedTable &&
            selectedGenes.length >= highVolumeGeneWarningThreshold) {
            getSession(model).notify(`Submitting ${selectedGenes.length} genes as separate BLASTP requests. NCBI may slow high-volume use; BlastTrack spaces submissions by at least 10 seconds and adds hits to one track as each gene finishes.`, 'warning');
        }
        const queries = [];
        const noSequenceFeatures = [];
        for (const [index, feature] of selectedGenes.entries()) {
            const name = String(getFeatureName(feature));
            const idPrefix = sanitizeTrackId(`${runPrefix}_gene_${index + 1}_${name}`);
            setProgress(`Translating gene ${index + 1}/${selectedGenes.length}: ${name}`);
            let sequence = '';
            try {
                sequence = cleanProteinSequence((await getProteinSequence({ feature, view: model })) ?? '');
            }
            catch (e) {
                noSequenceFeatures.push(queryGeneFeature({
                    feature,
                    hitCount: 0,
                    idPrefix,
                    status: 'no_sequence',
                    statusDetail: `sequence fetch failed: ${errorMessage(e)}`,
                }));
                continue;
            }
            if (sequence) {
                queries.push({
                    feature,
                    header: sanitizeFastaHeader(`gene_${index + 1}_${name}`),
                    idPrefix,
                    name,
                    queryIds: precomputedBlastQueryIds(feature, name),
                    sequence,
                });
            }
            else {
                noSequenceFeatures.push(queryGeneFeature({
                    feature,
                    hitCount: 0,
                    idPrefix,
                    status: 'no_sequence',
                }));
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
                trackId: sanitizeTrackId(`blastp_genes_no_sequence_${region.refName}_${region.start}_${region.end}_${Date.now()}`),
                view: model,
            });
            getSession(model).notify('Genes were found, but none had extractable CDS/protein sequence for BLASTP. Query markers were added to the BLAST track.', 'warning');
            return;
        }
        if (!selectedPrecomputedTable) {
            await runNcbiBlastpGeneQueries({
                displayedHitLimit,
                noSequenceFeatures,
                queries,
                region,
                runPrefix,
                sanitizedHitLimit,
                sanitizedHspLimit,
                sanitizedMinIdentityPercent,
            });
            return;
        }
        const query = queries
            .map(({ header, sequence }) => fastaRecord(header, sequence))
            .join('\n');
        const { reports, rid } = await queryLocalBlastReports({
            allHits: localAllHits,
            query,
            queryIds: queries.flatMap(({ queryIds }) => queryIds),
            blastDatabase: selectedPrecomputedTable,
            blastProgram: 'blastp',
            hitLimit: sanitizedHitLimit,
            hspLimit: sanitizedHspLimit,
            onProgress: message => {
                setProgress(`Precomputed BLASTP ${queries.length} genes: ${message}`);
            },
        });
        const resultBlastProgram = 'blastp';
        const resultSource = 'Precomputed BLASTP';
        const hitFeaturesByGene = new Map();
        const reportMatchesByGene = new Map();
        const hitFeatures = queries.flatMap(({ feature, header, idPrefix, queryIds, sequence }, index) => {
            const reportMatch = reportForQuery({
                candidateIds: [header, ...queryIds],
                fallbackIndex: index,
                header,
                queryCount: queries.length,
                reports,
            });
            reportMatchesByGene.set(feature, reportMatch);
            const renderedHits = featuresFromBlastHits({
                blastProgram: resultBlastProgram,
                highlightLongerSubjectProteins,
                hitLimit: displayedHitLimit,
                hspLimit: sanitizedHspLimit,
                hits: reportMatch.report?.hits ?? [],
                includeGenericDescriptions,
                idPrefix,
                minIdentityPercent: sanitizedMinIdentityPercent,
                queryFeature: feature,
                queryProteinLength: sequence.length,
                showMismatchMarkers,
                source: resultSource,
            });
            hitFeaturesByGene.set(feature, renderedHits);
            return renderedHits;
        });
        const queryStatusFeatures = queries.flatMap(({ feature, idPrefix }) => {
            const renderedHits = hitFeaturesByGene.get(feature) ?? [];
            const reportMatch = reportMatchesByGene.get(feature);
            if (renderedHits.length) {
                return [];
            }
            if (reportMatch?.report) {
                return [];
            }
            return [
                queryGeneFeature({
                    feature,
                    hitCount: 0,
                    idPrefix,
                    reportMatchedBy: reportMatch?.matchedBy,
                    reportQueryId: reportMatch?.report?.queryId,
                    reportQueryTitle: reportMatch?.report?.queryTitle,
                    status: 'no_report',
                }),
            ];
        });
        const features = [
            ...queryStatusFeatures,
            ...noSequenceFeatures,
            ...hitFeatures,
        ];
        if (!hitFeatures.length) {
            throw new Error(`No BLASTP hits passed the current filters. Try lowering minimum identity below ${sanitizedMinIdentityPercent}% or including hypothetical/uncharacterized hits.`);
        }
        addBlastFeatureTrack({
            appendToTrackId: appendToExistingTrack
                ? appendTargetTrack?.trackId
                : undefined,
            assemblyName: region.assemblyName,
            baseUrl: selectedPrecomputedTable ? undefined : ncbiBlastUrl,
            blastProgram: 'blastp',
            features,
            name: selectedPrecomputedTable
                ? `Precomputed BLASTP gene hits - ${regionLabel(region)}`
                : `BLASTP gene hits - ${regionLabel(region)}`,
            rid,
            trackId: sanitizeTrackId(`blastp_genes_${region.refName}_${region.start}_${region.end}_${rid}`),
            view: model,
        });
        const skippedNoSequence = selectedGenes.length - queries.length;
        const submittedWithoutHits = queryStatusFeatures.filter(feature => feature.blastStatus === 'no_hits').length;
        const submittedWithoutMatchedReport = queryStatusFeatures.filter(feature => feature.blastStatus === 'no_report').length;
        if (skippedNoSequence ||
            submittedWithoutHits ||
            submittedWithoutMatchedReport) {
            getSession(model).notify([
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
                .join('; '), 'warning');
        }
    }
    async function runNcbiBlastpGeneQueries({ displayedHitLimit, noSequenceFeatures, queries, region, runPrefix, sanitizedHitLimit, sanitizedHspLimit, sanitizedMinIdentityPercent, }) {
        const session = getSession(model);
        const trackId = sanitizeTrackId(`blastp_genes_${region.refName}_${region.start}_${region.end}_${runPrefix}`);
        const trackName = `BLASTP gene hits - ${regionLabel(region)}`;
        const resultSource = blastProgram === 'quick-blastp' ? 'NCBI quick-blastp' : 'NCBI BLASTP';
        addBlastFeatureTrack({
            appendToTrackId: appendToExistingTrack ? appendTargetTrack?.trackId : undefined,
            assemblyName: region.assemblyName,
            blastProgram: 'blastp',
            features: noSequenceFeatures,
            name: trackName,
            trackId,
            view: model,
        });
        session.notify(`Started BLASTP for ${queries.length} gene(s). Hits will be added to one track as each gene finishes.`);
        let finished = 0;
        let renderedGenes = 0;
        let genesWithoutRenderedHits = 0;
        const targetTrackId = appendToExistingTrack ? appendTargetTrack?.trackId : trackId;
        const jobs = queries.map(async (queryDef) => {
            try {
                const { hits, rid } = await queryBlast({
                    query: fastaRecord(queryDef.header, queryDef.sequence),
                    blastDatabase,
                    blastProgram,
                    hitLimit: sanitizedHitLimit,
                    baseUrl: ncbiBlastUrl,
                    onProgress: () => { },
                });
                const blastFeatures = featuresFromBlastHits({
                    blastProgram,
                    highlightLongerSubjectProteins,
                    hspLimit: sanitizedHspLimit,
                    hits,
                    includeGenericDescriptions,
                    idPrefix: queryDef.idPrefix,
                    minIdentityPercent: sanitizedMinIdentityPercent,
                    queryFeature: queryDef.feature,
                    queryProteinLength: queryDef.sequence.length,
                    hitLimit: displayedHitLimit,
                    showMismatchMarkers,
                    source: resultSource,
                });
                if (blastFeatures.length) {
                    renderedGenes += 1;
                    addBlastFeatureTrack({
                        appendToTrackId: targetTrackId,
                        assemblyName: region.assemblyName,
                        baseUrl: ncbiBlastUrl,
                        blastProgram: 'blastp',
                        features: blastFeatures,
                        name: trackName,
                        rid,
                        trackId,
                        view: model,
                    });
                }
                else {
                    genesWithoutRenderedHits += 1;
                }
            }
            catch (e) {
                genesWithoutRenderedHits += 1;
                getSession(model).notifyError(`BLASTP failed for ${queryDef.name}`, e);
            }
            finally {
                finished += 1;
            }
        });
        void Promise.allSettled(jobs).then(() => {
            session.notify([
                `BLASTP finished for ${finished}/${queries.length} submitted gene(s)`,
                renderedGenes
                    ? `${renderedGenes} gene(s) added hits to the track`
                    : 'no genes added visible hits',
                genesWithoutRenderedHits
                    ? `${genesWithoutRenderedHits} gene(s) had no hits passing filters`
                    : '',
                noSequenceFeatures.length
                    ? `${noSequenceFeatures.length} gene(s) had no CDS/protein sequence`
                    : '',
            ]
                .filter(Boolean)
                .join('; '), genesWithoutRenderedHits || noSequenceFeatures.length ? 'warning' : undefined);
        });
    }
    return (_jsxs(Dialog, { maxWidth: "lg", title: title, open: true, onClose: handleClose, children: [_jsxs(DialogContent, { sx: { width: '48rem', maxWidth: '90vw' }, children: [error ? _jsx(ErrorMessage, { error: error }) : null, mode === 'blastp-genes' ? (_jsxs(_Fragment, { children: [_jsx(TextField, { margin: "normal", select: true, label: "BLAST database", value: blastDatabase, onChange: event => {
                                    const nextDatabase = event.target.value;
                                    setBlastDatabase(nextDatabase);
                                    if (nextDatabase === 'nr_cluster_seq') {
                                        setBlastProgram('blastp');
                                    }
                                }, sx: { mr: 2, minWidth: 180 }, children: proteinDatabaseOptions.map(option => (_jsx(MenuItem, { value: option, children: option }, option))) }), _jsx(TextField, { margin: "normal", select: true, label: "BLAST program", value: blastProgram, disabled: blastDatabase === 'nr_cluster_seq', onChange: event => {
                                    setBlastProgram(event.target.value);
                                }, sx: { minWidth: 180 }, children: proteinProgramOptions.map(option => (_jsx(MenuItem, { value: option, children: option === 'quick-blastp'
                                        ? 'quick-blastp (faster NCBI protein BLAST)'
                                        : 'blastp (standard, slower)' }, option))) })] })) : (_jsxs(_Fragment, { children: [_jsx(TextField, { margin: "normal", label: "BLAST database", value: blastDatabase, onChange: event => {
                                    setBlastDatabase(event.target.value);
                                }, sx: { mr: 2, minWidth: 180 } }), _jsx(TextField, { margin: "normal", type: "number", label: "Max region bp", value: maxRegionBp, onChange: event => {
                                    setMaxRegionBp(Number(event.target.value));
                                }, sx: { width: 150 } })] })), _jsx(TextField, { disabled: Boolean(mode === 'blastp-genes' && precomputedBlastTable && localAllHits), margin: "normal", type: "number", label: mode === 'blastp-genes' ? 'Hits per gene' : 'Hits', helperText: mode === 'blastp-genes'
                            ? 'BLAST subject hits per query gene'
                            : 'BLAST subject hits for this region', value: hitLimit, onChange: event => {
                            setHitLimit(Number(event.target.value));
                        }, sx: { ml: 2, width: mode === 'blastp-genes' ? 190 : 180 } }), mode === 'blastp-genes' ? (_jsx(TextField, { margin: "normal", type: "number", label: "Minimum identity (%)", helperText: "Weighted across each BLASTP hit before rendering", value: minIdentityPercent, onChange: event => {
                            setMinIdentityPercent(Number(event.target.value));
                        }, sx: { ml: 2, width: 210 } })) : null, _jsx(TextField, { margin: "normal", type: "number", label: "Alignment segments", helperText: "1 = best segment, most sensitive; 3 = looser and may draw less accurate segments", value: hspLimit, onChange: event => {
                            setHspLimit(Number(event.target.value));
                        }, sx: { ml: 2, width: 210 } }), mode === 'blastp-genes' ? (_jsxs(_Fragment, { children: [_jsx(FormControlLabel, { control: _jsx(Checkbox, { checked: includeGenericDescriptions, onChange: event => {
                                        setIncludeGenericDescriptions(event.target.checked);
                                    } }), label: "Include hypothetical/uncharacterized hits" }), _jsx(FormControlLabel, { control: _jsx(Checkbox, { checked: highlightLongerSubjectProteins, onChange: event => {
                                        setHighlightLongerSubjectProteins(event.target.checked);
                                    } }), label: "Highlight larger subject proteins" })] })) : null, _jsx(FormControlLabel, { control: _jsx(Checkbox, { checked: showMismatchMarkers, onChange: event => {
                                setShowMismatchMarkers(event.target.checked);
                            } }), label: "Show mismatch/gap ticks" }), appendTargetTrack ? (_jsx(FormControlLabel, { control: _jsx(Checkbox, { checked: appendToExistingTrack, onChange: event => {
                                setAppendToExistingTrack(event.target.checked);
                            } }), label: `Append to existing ${appendBlastProgram.toUpperCase()} track (experimental): ${appendTargetTrack.name}` })) : null, _jsxs(Typography, { sx: { mt: 2 }, variant: "body2", children: ["Selection: ", regionText] }), _jsx(Typography, { sx: { mt: 1 }, variant: "body2", children: mode === 'blastp-genes'
                            ? 'One BLASTP request will be submitted per selected gene, using the longest detected isoform per gene. Hits are drawn over each query gene CDS and added to the same track as each request finishes.'
                            : mode === 'tblastx-region'
                                ? 'The selected reference sequence will be submitted to tblastx. Translated HSPs are drawn over the selected genomic span.'
                                : 'The selected reference sequence will be submitted to blastn. HSPs are drawn over the selected genomic span.' }), _jsx(Typography, { sx: { mt: 1 }, variant: "body2", children: "Mismatch and gap counts are kept in feature details. Red mismatch and yellow gap ticks are optional because dense alignments can be difficult to read." }), _jsx(Typography, { sx: { mt: 1 }, variant: "body2", children: "BlastTrack spaces NCBI submissions at least 10 seconds apart and polls each RID every 30 seconds after the first check." }), mode === 'blastp-genes' ? (_jsxs(_Fragment, { children: [_jsx(Typography, { sx: { mt: 3 }, variant: "subtitle2", children: "Precomputed BLASTP table" }), _jsx(Button, { disabled: running || loadingLocalDatabases, onClick: () => {
                                    void loadLocalDatabases();
                                }, sx: { mt: 1, mr: 1 }, variant: "outlined", children: "Load tables" }), _jsx(LocalBlastHelp, {}), localBlastDatabases.length ? (_jsx(TextField, { margin: "normal", select: true, label: "Precomputed table", value: precomputedBlastTableValue, onChange: event => {
                                    setPrecomputedBlastTableValue(event.target.value);
                                }, sx: { ml: 2, minWidth: 260 }, children: localBlastDatabases.map(database => (_jsx(MenuItem, { value: localBlastDatabaseValue(database), children: database.title ?? database.name }, database.id))) })) : null, precomputedBlastTable ? (_jsx(FormControlLabel, { control: _jsx(Checkbox, { checked: localAllHits, onChange: event => {
                                        setLocalAllHits(event.target.checked);
                                    } }), label: "All precomputed BLAST hits" })) : null, _jsx(Typography, { sx: { mt: 1 }, variant: "body2", children: "Precomputed tables read static tabix-indexed BLASTP rows by selected query IDs; they do not submit a BLAST job." })] })) : null, running ? (_jsx(ProgressDots, { message: progress })) : null] }), _jsxs(DialogActions, { children: [_jsx(Button, { disabled: running, onClick: () => {
                            void runBlast();
                        }, variant: "contained", children: mode === 'blastp-genes' ? 'Submit NCBI BLAST' : 'Submit' }), mode === 'blastp-genes' ? (_jsx(Button, { disabled: running || !precomputedBlastTable, onClick: () => {
                            void runPrecomputedBlastpGenes();
                        }, variant: "outlined", children: "Load Precomputed Hits" })) : null, _jsx(Button, { disabled: running, onClick: handleClose, children: "Cancel" })] })] }));
}
function getSingleRegion(regions) {
    if (regions.length !== 1) {
        throw new Error(`BLAST currently supports one continuous selected region; this selection contains ${regions.length}.`);
    }
    const region = regions[0];
    if (region.end <= region.start) {
        throw new Error('Selected region has no length');
    }
    return region;
}
function sanitizeHitLimit(value, fallback) {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(100, Math.max(1, Math.floor(value)));
}
function sanitizeHspLimit(value) {
    if (!Number.isFinite(value)) {
        return defaultHspLimit;
    }
    return Math.min(100, Math.max(1, Math.floor(value)));
}
function sanitizeMinIdentityPercent(value) {
    if (!Number.isFinite(value)) {
        return defaultMinIdentityPercent;
    }
    return Math.min(100, Math.max(0, Number(value)));
}
function sanitizeMaxRegionBp(value) {
    if (!Number.isFinite(value)) {
        return defaultMaxRegionBp;
    }
    return Math.min(1_000_000, Math.max(1, Math.floor(value)));
}
function cleanProteinSequence(sequence) {
    return sequence.replaceAll(/[^A-Za-z*]/g, '').toUpperCase();
}
function cleanNucleotideSequence(sequence) {
    return sequence.replaceAll(/[^A-Za-z]/g, '').toUpperCase();
}
function fastaRecord(header, sequence) {
    return `>${sanitizeFastaHeader(header)}\n${wrapSequence(sequence)}`;
}
function sanitizeFastaHeader(header) {
    return sanitizeTrackId(header).slice(0, 120) || 'query';
}
function reportForQuery({ candidateIds, fallbackIndex, header, queryCount, reports, }) {
    const normalizedIds = (candidateIds ?? [header])
        .map(normalizeReportId)
        .filter(Boolean);
    const queryIdMatch = reports.find(report => Boolean(normalizeReportId(report.queryId) &&
        normalizedIds.includes(normalizeReportId(report.queryId))));
    if (queryIdMatch) {
        return { matchedBy: 'query_id', report: queryIdMatch };
    }
    const queryTitleMatch = reports.find(report => {
        const normalizedTitle = normalizeReportId(report.queryTitle);
        if (!normalizedTitle) {
            return false;
        }
        return normalizedIds.some(normalizedId => normalizedTitle === normalizedId ||
            normalizedTitle.startsWith(`${normalizedId}_`) ||
            normalizedTitle.includes(`_${normalizedId}_`));
    });
    if (queryTitleMatch) {
        return { matchedBy: 'query_title', report: queryTitleMatch };
    }
    if (reports.length === queryCount) {
        return { matchedBy: 'response_order', report: reports[fallbackIndex] };
    }
    return {};
}
function normalizeReportId(value) {
    return value?.replaceAll(/[^A-Za-z0-9]+/g, '_').replaceAll(/^_+|_+$/g, '');
}
function precomputedBlastQueryIds(feature, featureName) {
    const json = feature.toJSON();
    const bestTranscript = bestTranscriptFeature(json);
    return uniqueStrings(uniqueStrings([
        ...idsFromFeatureJson(bestTranscript),
        ...idsFromFeatureJson(json),
        stringValue(featureName),
        stringValue(feature.id()),
        stringValue(feature.get('id')),
        stringValue(feature.get('name')),
        stringValue(feature.get('gene_id')),
        stringValue(feature.get('transcript_id')),
        ...idsFromFeatureJson(...(json.subfeatures ?? [])),
    ]).flatMap(id => idAliases(id)));
}
function bestTranscriptFeature(feature) {
    const candidates = transcriptCandidates(feature);
    return candidates.sort((a, b) => cdsLength(b) - cdsLength(a))[0];
}
function transcriptCandidates(feature) {
    const subfeatures = feature.subfeatures ?? [];
    return [
        ...(feature.type === 'mRNA' || feature.type === 'transcript'
            ? [feature]
            : []),
        ...subfeatures.flatMap(transcriptCandidates),
    ];
}
function cdsLength(feature) {
    return collectCds(feature).reduce((total, cds) => total + Math.max(0, (cds.end ?? 0) - (cds.start ?? 0)), 0);
}
function collectCds(feature) {
    return [
        ...(feature.type === 'CDS' ? [feature] : []),
        ...(feature.subfeatures ?? []).flatMap(collectCds),
    ];
}
function idsFromFeatureJson(...features) {
    return features.flatMap(feature => feature
        ? [
            stringValue(feature.id),
            stringValue(feature.name),
            stringValue(feature.gene_id),
            stringValue(feature.transcript_id),
            stringValue(feature.protein_id),
            stringValue(feature.Parent),
            stringValue(feature.parent),
        ]
        : []);
}
function idAliases(id) {
    const trimmed = id.trim();
    const firstToken = trimmed.split(/\s+/)[0];
    const withoutPrefix = firstToken.replace(/^(rna|transcript|mrna|cds|protein)[:-]/i, '');
    return uniqueStrings([
        trimmed,
        firstToken,
        withoutPrefix,
        withoutPrefix.replace(/\.(?:p|protein)\d*$/i, ''),
        withoutPrefix.replace(/\.prot$/i, ''),
    ]);
}
function stringValue(value) {
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === 'string' || typeof first === 'number'
        ? String(first)
        : '';
}
function uniqueStrings(values) {
    return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}
function wrapSequence(sequence) {
    return sequence.match(/.{1,60}/g)?.join('\n') ?? sequence;
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
