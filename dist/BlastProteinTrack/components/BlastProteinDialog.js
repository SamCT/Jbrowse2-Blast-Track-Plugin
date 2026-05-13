import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { Dialog, ErrorMessage } from '@jbrowse/core/ui';
import { getContainingView } from '@jbrowse/core/util';
import { Button, Checkbox, DialogActions, DialogContent, FormControlLabel, MenuItem, TextField, Typography, } from '@mui/material';
import ProgressDots from './ProgressDots';
import LocalBlastHelp from './LocalBlastHelp';
import { featuresFromBlastHits } from '../utils/blastFeatures';
import { addBlastFeatureTrack, getAppendableBlastTracks, sanitizeTrackId, } from '../utils/blastTrackConfig';
import { getFeatureName } from '../utils/featureSequence';
import { fetchLocalBlastDatabases, localBlastDatabaseValue, queryLocalBlast, selectedLocalBlastDatabase, } from '../utils/localBlast';
import { queryBlast } from '../utils/ncbiBlast';
import { getProteinSequence } from '../utils/proteinFromCds';
const blastDatabaseOptions = ['nr', 'nr_cluster_seq'];
const blastProgramOptions = ['blastp', 'quick-blastp'];
const defaultBlastDatabase = 'nr_cluster_seq';
const defaultBlastProgram = 'blastp';
const defaultHitLimit = 3;
const defaultHspLimit = 1;
const defaultMinIdentityPercent = 30;
const ncbiBlastUrl = 'https://blast.ncbi.nlm.nih.gov/Blast.cgi';
export default function BlastProteinDialog({ handleClose, model, feature, }) {
    const view = getContainingView(model);
    const featureName = getFeatureName(feature);
    const assemblyName = view.assemblyNames?.[0] ?? feature.get('assemblyName') ?? '';
    const appendableBlastTracks = useMemo(() => getAppendableBlastTracks({
        assemblyName,
        blastProgram: 'blastp',
        view,
    }), [assemblyName, view]);
    const [blastDatabase, setBlastDatabase] = useState(defaultBlastDatabase);
    const [blastProgram, setBlastProgram] = useState(defaultBlastProgram);
    const [hitLimit, setHitLimit] = useState(defaultHitLimit);
    const [hspLimit, setHspLimit] = useState(defaultHspLimit);
    const [localBlastDatabases, setLocalBlastDatabases] = useState([]);
    const [precomputedBlastTableValue, setPrecomputedBlastTableValue] = useState('');
    const [loadingLocalDatabases, setLoadingLocalDatabases] = useState(false);
    const [localAllHits, setLocalAllHits] = useState(false);
    const [minIdentityPercent, setMinIdentityPercent] = useState(defaultMinIdentityPercent);
    const [includeGenericDescriptions, setIncludeGenericDescriptions] = useState(true);
    const [highlightLongerSubjectProteins, setHighlightLongerSubjectProteins] = useState(true);
    const [showMismatchMarkers, setShowMismatchMarkers] = useState(false);
    const [progress, setProgress] = useState('');
    const [error, setError] = useState();
    const [proteinLength, setProteinLength] = useState();
    const [running, setRunning] = useState(false);
    const [appendToExistingTrack, setAppendToExistingTrack] = useState(false);
    const appendTargetTrack = appendableBlastTracks[0];
    const precomputedBlastTable = selectedLocalBlastDatabase({
        databases: localBlastDatabases,
        value: precomputedBlastTableValue,
    });
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
    async function runBlast() {
        await runBlastSource('ncbi');
    }
    async function runPrecomputedBlast() {
        await runBlastSource('precomputed');
    }
    async function runBlastSource(source) {
        try {
            setRunning(true);
            setError(undefined);
            const selectedPrecomputedTable = source === 'precomputed' ? precomputedBlastTable : undefined;
            if (source === 'precomputed' && !selectedPrecomputedTable) {
                throw new Error('Choose a precomputed BLASTP table first.');
            }
            setProgress(`Preparing protein sequence for ${featureName}...`);
            const cleanedSequence = cleanProteinSequence((await getProteinSequence({ feature, view })) ?? '');
            setProteinLength(cleanedSequence.length);
            if (!cleanedSequence) {
                throw new Error('No protein sequence was found on this feature. Add protein_sequence, proteinSequence, translation, or seq to the feature attributes, or wire CDS translation extraction into featureSequence.ts.');
            }
            const sanitizedHitLimit = sanitizeHitLimit(hitLimit);
            const sanitizedHspLimit = sanitizeHspLimit(hspLimit);
            const sanitizedMinIdentityPercent = sanitizeMinIdentityPercent(minIdentityPercent);
            const displayedHitLimit = selectedPrecomputedTable && localAllHits
                ? Number.POSITIVE_INFINITY
                : sanitizedHitLimit;
            const query = `>${featureName}\n${cleanedSequence}`;
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
                });
            const resultBlastProgram = selectedPrecomputedTable ? 'blastp' : blastProgram;
            const resultSource = selectedPrecomputedTable
                ? 'Precomputed BLASTP'
                : blastProgram === 'quick-blastp'
                    ? 'NCBI quick-blastp'
                    : 'NCBI BLASTP';
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
            });
            if (!blastFeatures.length) {
                throw new Error(`No BLASTP hits passed the current filters. Try lowering minimum identity below ${sanitizedMinIdentityPercent}% or including hypothetical/uncharacterized hits.`);
            }
            const trackId = sanitizeTrackId(`blastp_${feature.id()}_${rid}`);
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
            });
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
    return (_jsxs(Dialog, { maxWidth: "lg", title: "BLAST protein and load track", open: true, onClose: handleClose, children: [_jsxs(DialogContent, { sx: { width: '48rem', maxWidth: '90vw' }, children: [error ? _jsx(ErrorMessage, { error: error }) : null, _jsx(TextField, { margin: "normal", select: true, label: "BLAST database", value: blastDatabase, onChange: event => {
                            const nextDatabase = event.target.value;
                            setBlastDatabase(nextDatabase);
                            if (nextDatabase === 'nr_cluster_seq') {
                                setBlastProgram('blastp');
                            }
                        }, sx: { mr: 2, minWidth: 180 }, children: blastDatabaseOptions.map(option => (_jsx(MenuItem, { value: option, children: option }, option))) }), _jsx(TextField, { margin: "normal", select: true, label: "BLAST program", value: blastProgram, disabled: blastDatabase === 'nr_cluster_seq', onChange: event => {
                            setBlastProgram(event.target.value);
                        }, sx: { minWidth: 180 }, children: blastProgramOptions.map(option => (_jsx(MenuItem, { value: option, children: option === 'quick-blastp'
                                ? 'quick-blastp (faster NCBI protein BLAST)'
                                : 'blastp (standard, slower)' }, option))) }), _jsx(TextField, { disabled: Boolean(precomputedBlastTable && localAllHits), margin: "normal", type: "number", label: "Number of matches", helperText: "Distinct subject proteins to keep for this gene", value: hitLimit, onChange: event => {
                            setHitLimit(Number(event.target.value));
                        }, sx: { ml: 2, width: 210 } }), _jsx(TextField, { margin: "normal", type: "number", label: "Minimum identity (%)", helperText: "Weighted across the BLASTP hit before rendering", value: minIdentityPercent, onChange: event => {
                            setMinIdentityPercent(Number(event.target.value));
                        }, sx: { ml: 2, width: 210 } }), _jsx(TextField, { margin: "normal", type: "number", label: "Alignment segments", helperText: "1 = best segment, most sensitive; 3 = looser and may draw less accurate segments", value: hspLimit, onChange: event => {
                            setHspLimit(Number(event.target.value));
                        }, sx: { ml: 2, width: 210 } }), _jsx(FormControlLabel, { control: _jsx(Checkbox, { checked: includeGenericDescriptions, onChange: event => {
                                setIncludeGenericDescriptions(event.target.checked);
                            } }), label: "Include hypothetical/uncharacterized hits" }), _jsx(FormControlLabel, { control: _jsx(Checkbox, { checked: highlightLongerSubjectProteins, onChange: event => {
                                setHighlightLongerSubjectProteins(event.target.checked);
                            } }), label: "Highlight larger subject proteins" }), _jsx(FormControlLabel, { control: _jsx(Checkbox, { checked: showMismatchMarkers, onChange: event => {
                                setShowMismatchMarkers(event.target.checked);
                            } }), label: "Show mismatch/gap ticks" }), appendTargetTrack ? (_jsx(FormControlLabel, { control: _jsx(Checkbox, { checked: appendToExistingTrack, onChange: event => {
                                setAppendToExistingTrack(event.target.checked);
                            } }), label: `Append to existing BLASTP track (experimental): ${appendTargetTrack.name}` })) : null, _jsxs(Typography, { sx: { mt: 2 }, variant: "body2", children: ["Query feature: ", featureName] }), _jsxs(Typography, { variant: "body2", children: ["Protein length:", ' ', proteinLength === undefined
                                ? 'detected when submitted'
                                : `${proteinLength} aa`] }), _jsx(Typography, { sx: { mt: 1 }, variant: "body2", children: "BLASTP protein HSPs will be projected onto CDS exons. Blue blocks are aligned HSP segments. Mismatch and gap counts remain available in feature details; red mismatch and yellow gap ticks are optional because dense alignments can become hard to read." }), _jsx(Typography, { sx: { mt: 1 }, variant: "body2", children: "BlastTrack spaces NCBI BLAST submissions at least 10 seconds apart and polls each RID every 30 seconds after the first check." }), _jsx(Typography, { sx: { mt: 3 }, variant: "subtitle2", children: "Precomputed BLASTP table" }), _jsx(Button, { disabled: running || loadingLocalDatabases, onClick: () => {
                            void loadLocalDatabases();
                        }, sx: { mt: 1, mr: 1 }, variant: "outlined", children: "Load tables" }), _jsx(LocalBlastHelp, {}), localBlastDatabases.length ? (_jsx(TextField, { margin: "normal", select: true, label: "Precomputed table", value: precomputedBlastTableValue, onChange: event => {
                            setPrecomputedBlastTableValue(event.target.value);
                        }, sx: { ml: 2, minWidth: 260 }, children: localBlastDatabases.map(database => (_jsx(MenuItem, { value: localBlastDatabaseValue(database), children: database.title ?? database.name }, database.id))) })) : null, precomputedBlastTable ? (_jsx(FormControlLabel, { control: _jsx(Checkbox, { checked: localAllHits, onChange: event => {
                                setLocalAllHits(event.target.checked);
                            } }), label: "All precomputed BLAST hits" })) : null, _jsx(Typography, { sx: { mt: 1 }, variant: "body2", children: "Precomputed tables read static tabix-indexed BLASTP rows by clicked query ID; they do not submit a BLAST job." }), running ? (_jsx(ProgressDots, { message: progress })) : null] }), _jsxs(DialogActions, { children: [_jsx(Button, { disabled: running, onClick: () => {
                            void runBlast();
                        }, variant: "contained", children: "Submit NCBI BLAST" }), _jsx(Button, { disabled: running || !precomputedBlastTable, onClick: () => {
                            void runPrecomputedBlast();
                        }, variant: "outlined", children: "Load Precomputed Hits" }), _jsx(Button, { disabled: running, onClick: handleClose, children: "Cancel" })] })] }));
}
function sanitizeHitLimit(value) {
    if (!Number.isFinite(value)) {
        return defaultHitLimit;
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
function cleanProteinSequence(sequence) {
    return sequence.replaceAll(/[^A-Za-z*]/g, '').toUpperCase();
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
