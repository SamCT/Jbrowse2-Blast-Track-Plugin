import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Dialog, ErrorMessage } from '@jbrowse/core/ui';
import { getContainingView } from '@jbrowse/core/util';
import { Button, Checkbox, DialogActions, DialogContent, FormControlLabel, LinearProgress, MenuItem, TextField, Typography, } from '@mui/material';
import { featuresFromBlastHits } from '../utils/blastFeatures';
import { addBlastFeatureTrack, sanitizeTrackId } from '../utils/blastTrackConfig';
import { getFeatureName } from '../utils/featureSequence';
import { queryBlast } from '../utils/ncbiBlast';
import { readStoredContactEmail, storeContactEmail, } from '../utils/ncbiSettings';
import { getProteinSequence } from '../utils/proteinFromCds';
const blastDatabaseOptions = ['nr', 'nr_clustered_seq'];
const blastProgramOptions = ['blastp', 'quick-blastp'];
const defaultHitLimit = 3;
const defaultHspLimit = 3;
export default function BlastProteinDialog({ handleClose, model, feature, }) {
    const view = getContainingView(model);
    const [blastDatabase, setBlastDatabase] = useState('nr');
    const [blastProgram, setBlastProgram] = useState('quick-blastp');
    const [baseUrl, setBaseUrl] = useState('https://blast.ncbi.nlm.nih.gov/Blast.cgi');
    const [contactEmail, setContactEmail] = useState(readStoredContactEmail);
    const [hitLimit, setHitLimit] = useState(defaultHitLimit);
    const [hspLimit, setHspLimit] = useState(defaultHspLimit);
    const [showMismatchMarkers, setShowMismatchMarkers] = useState(false);
    const [progress, setProgress] = useState('');
    const [error, setError] = useState();
    const [proteinSequence, setProteinSequence] = useState('');
    const [sequenceLoading, setSequenceLoading] = useState(false);
    const [running, setRunning] = useState(false);
    const featureName = getFeatureName(feature);
    useEffect(() => {
        let active = true;
        setSequenceLoading(true);
        getProteinSequence({ feature, view })
            .then(sequence => {
            if (active) {
                setProteinSequence(sequence ?? '');
            }
        })
            .catch(e => {
            if (active) {
                setError(e);
                setProteinSequence('');
            }
        })
            .finally(() => {
            if (active) {
                setSequenceLoading(false);
            }
        });
        return () => {
            active = false;
        };
    }, [feature, view]);
    async function runBlast() {
        if (!proteinSequence) {
            setError(new Error('No protein sequence was found on this feature. Add protein_sequence, proteinSequence, translation, or seq to the feature attributes, or wire CDS translation extraction into featureSequence.ts.'));
            return;
        }
        try {
            setRunning(true);
            setError(undefined);
            const cleanedSequence = proteinSequence.replaceAll(/[^A-Za-z*]/g, '');
            const sanitizedContactEmail = contactEmail.trim();
            const sanitizedHitLimit = sanitizeHitLimit(hitLimit);
            const sanitizedHspLimit = sanitizeHspLimit(hspLimit);
            storeContactEmail(sanitizedContactEmail);
            const { hits, rid } = await queryBlast({
                query: `>${featureName}\n${cleanedSequence}`,
                blastDatabase,
                blastProgram,
                contactEmail: sanitizedContactEmail,
                hitLimit: sanitizedHitLimit,
                baseUrl,
                onProgress: setProgress,
            });
            const blastFeatures = featuresFromBlastHits({
                hspLimit: sanitizedHspLimit,
                hits,
                queryFeature: feature,
                queryProteinLength: cleanedSequence.length,
                hitLimit: sanitizedHitLimit,
                showMismatchMarkers,
            });
            const assemblyName = view.assemblyNames?.[0] ?? feature.get('assemblyName') ?? '';
            const trackId = sanitizeTrackId(`blastp_${feature.id()}_${rid}`);
            addBlastFeatureTrack({
                assemblyName,
                baseUrl,
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
    return (_jsxs(Dialog, { maxWidth: "lg", title: "BLAST protein and load track", open: true, onClose: handleClose, children: [_jsxs(DialogContent, { sx: { width: '48rem', maxWidth: '90vw' }, children: [error ? _jsx(ErrorMessage, { error: error }) : null, _jsx(TextField, { margin: "normal", fullWidth: true, label: "NCBI BLAST URL", value: baseUrl, onChange: event => {
                            setBaseUrl(event.target.value);
                        } }), _jsx(TextField, { margin: "normal", fullWidth: true, label: "Contact email for NCBI (optional)", helperText: "NCBI requests that API users provide email and tool parameters for problem contact.", value: contactEmail, onChange: event => {
                            setContactEmail(event.target.value);
                        } }), _jsx(TextField, { margin: "normal", select: true, label: "BLAST database", value: blastDatabase, onChange: event => {
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
                                : 'blastp (standard, slower)' }, option))) }), _jsx(TextField, { margin: "normal", type: "number", label: "Max hits", value: hitLimit, onChange: event => {
                            setHitLimit(Number(event.target.value));
                        }, sx: { ml: 2, width: 120 } }), _jsx(TextField, { margin: "normal", type: "number", label: "Max HSPs/hit", value: hspLimit, onChange: event => {
                            setHspLimit(Number(event.target.value));
                        }, sx: { ml: 2, width: 140 } }), _jsx(FormControlLabel, { control: _jsx(Checkbox, { checked: showMismatchMarkers, onChange: event => {
                                setShowMismatchMarkers(event.target.checked);
                            } }), label: "Show mismatch/gap ticks" }), _jsxs(Typography, { sx: { mt: 2 }, variant: "body2", children: ["Query feature: ", featureName] }), _jsxs(Typography, { variant: "body2", children: ["Protein length: ", sequenceLoading ? 'loading...' : `${proteinSequence.length} aa`] }), _jsx(Typography, { sx: { mt: 1 }, variant: "body2", children: "BLASTP protein HSPs will be projected onto CDS exons. Blue blocks are aligned HSP segments. Mismatch and gap counts remain available in feature details; red per-residue ticks are optional because dense alignments can become hard to read." }), _jsx(Typography, { sx: { mt: 1 }, variant: "body2", children: "BlastTrack spaces NCBI BLAST submissions at least 10 seconds apart and polls each RID once per minute." }), running ? (_jsxs(_Fragment, { children: [_jsx(LinearProgress, { sx: { mt: 2 } }), _jsx(Typography, { sx: { mt: 1 }, variant: "body2", children: progress })] })) : null] }), _jsxs(DialogActions, { children: [_jsx(Button, { disabled: running || sequenceLoading || !proteinSequence, onClick: () => {
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
