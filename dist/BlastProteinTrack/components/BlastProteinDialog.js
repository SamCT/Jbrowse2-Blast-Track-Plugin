import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { Dialog, ErrorMessage } from '@jbrowse/core/ui';
import { getContainingView } from '@jbrowse/core/util';
import { Button, Checkbox, DialogActions, DialogContent, FormControlLabel, MenuItem, TextField, Typography, } from '@mui/material';
import ProgressDots from './ProgressDots';
import { featuresFromBlastHits } from '../utils/blastFeatures';
import { addBlastFeatureTrack, getAppendableBlastTracks, sanitizeTrackId, } from '../utils/blastTrackConfig';
import { getFeatureName } from '../utils/featureSequence';
import { queryBlast } from '../utils/ncbiBlast';
import { getProteinSequence } from '../utils/proteinFromCds';
const blastDatabaseOptions = ['nr', 'nr_clustered_seq'];
const blastProgramOptions = ['blastp', 'quick-blastp'];
const defaultBlastDatabase = 'nr_clustered_seq';
const defaultBlastProgram = 'blastp';
const defaultHitLimit = 3;
const defaultHspLimit = 1;
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
    const [showMismatchMarkers, setShowMismatchMarkers] = useState(false);
    const [progress, setProgress] = useState('');
    const [error, setError] = useState();
    const [proteinLength, setProteinLength] = useState();
    const [running, setRunning] = useState(false);
    const [appendToExistingTrack, setAppendToExistingTrack] = useState(false);
    const appendTargetTrack = appendableBlastTracks[0];
    async function runBlast() {
        try {
            setRunning(true);
            setError(undefined);
            setProgress(`Preparing protein sequence for ${featureName}...`);
            const cleanedSequence = cleanProteinSequence((await getProteinSequence({ feature, view })) ?? '');
            setProteinLength(cleanedSequence.length);
            if (!cleanedSequence) {
                throw new Error('No protein sequence was found on this feature. Add protein_sequence, proteinSequence, translation, or seq to the feature attributes, or wire CDS translation extraction into featureSequence.ts.');
            }
            const sanitizedHitLimit = sanitizeHitLimit(hitLimit);
            const sanitizedHspLimit = sanitizeHspLimit(hspLimit);
            const { hits, rid } = await queryBlast({
                query: `>${featureName}\n${cleanedSequence}`,
                blastDatabase,
                blastProgram,
                hitLimit: sanitizedHitLimit,
                baseUrl: ncbiBlastUrl,
                onProgress: setProgress,
            });
            const blastFeatures = featuresFromBlastHits({
                hspLimit: sanitizedHspLimit,
                hits,
                idPrefix: sanitizeTrackId(`${feature.id()}_${rid}`),
                queryFeature: feature,
                queryProteinLength: cleanedSequence.length,
                hitLimit: sanitizedHitLimit,
                showMismatchMarkers,
            });
            const trackId = sanitizeTrackId(`blastp_${feature.id()}_${rid}`);
            addBlastFeatureTrack({
                appendToTrackId: appendToExistingTrack
                    ? appendTargetTrack?.trackId
                    : undefined,
                assemblyName,
                baseUrl: ncbiBlastUrl,
                blastProgram: 'blastp',
                features: blastFeatures,
                name: `BLASTP hits - ${featureName}`,
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
                            const nextDatabase = event.target
                                .value;
                            setBlastDatabase(nextDatabase);
                            if (nextDatabase === 'nr_clustered_seq') {
                                setBlastProgram('blastp');
                            }
                        }, sx: { mr: 2, minWidth: 180 }, children: blastDatabaseOptions.map(option => (_jsx(MenuItem, { value: option, children: option }, option))) }), _jsx(TextField, { margin: "normal", select: true, label: "BLAST program", value: blastProgram, disabled: blastDatabase === 'nr_clustered_seq', onChange: event => {
                            setBlastProgram(event.target.value);
                        }, sx: { minWidth: 180 }, children: blastProgramOptions.map(option => (_jsx(MenuItem, { value: option, children: option === 'quick-blastp'
                                ? 'quick-blastp (faster NCBI protein BLAST)'
                                : 'blastp (standard, slower)' }, option))) }), _jsx(TextField, { margin: "normal", type: "number", label: "Number of matches", helperText: "Distinct subject proteins to keep for this gene", value: hitLimit, onChange: event => {
                            setHitLimit(Number(event.target.value));
                        }, sx: { ml: 2, width: 210 } }), _jsx(TextField, { margin: "normal", type: "number", label: "Alignment segments", helperText: "1 = best segment, most sensitive; 3 = looser and may draw less accurate segments", value: hspLimit, onChange: event => {
                            setHspLimit(Number(event.target.value));
                        }, sx: { ml: 2, width: 210 } }), _jsx(FormControlLabel, { control: _jsx(Checkbox, { checked: showMismatchMarkers, onChange: event => {
                                setShowMismatchMarkers(event.target.checked);
                            } }), label: "Show mismatch/gap ticks" }), appendTargetTrack ? (_jsx(FormControlLabel, { control: _jsx(Checkbox, { checked: appendToExistingTrack, onChange: event => {
                                setAppendToExistingTrack(event.target.checked);
                            } }), label: `Append to existing BLASTP track (experimental): ${appendTargetTrack.name}` })) : null, _jsxs(Typography, { sx: { mt: 2 }, variant: "body2", children: ["Query feature: ", featureName] }), _jsxs(Typography, { variant: "body2", children: ["Protein length:", ' ', proteinLength === undefined
                                ? 'detected when submitted'
                                : `${proteinLength} aa`] }), _jsx(Typography, { sx: { mt: 1 }, variant: "body2", children: "BLASTP protein HSPs will be projected onto CDS exons. Blue blocks are aligned HSP segments. Mismatch and gap counts remain available in feature details; red mismatch and yellow gap ticks are optional because dense alignments can become hard to read." }), _jsx(Typography, { sx: { mt: 1 }, variant: "body2", children: "BlastTrack spaces NCBI BLAST submissions at least 10 seconds apart and polls each RID once per minute." }), running ? (_jsx(ProgressDots, { message: progress })) : null] }), _jsxs(DialogActions, { children: [_jsx(Button, { disabled: running, onClick: () => {
                            void runBlast();
                        }, variant: "contained", children: "Submit" }), _jsx(Button, { disabled: running, onClick: handleClose, children: "Cancel" })] })] }));
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
function cleanProteinSequence(sequence) {
    return sequence.replaceAll(/[^A-Za-z*]/g, '').toUpperCase();
}
