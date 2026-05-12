import { readConfObject } from '@jbrowse/core/configuration';
import { getSession } from '@jbrowse/core/util';
export function addBlastFeatureTrack({ appendToTrackId, assemblyName, baseUrl, blastProgram, features, name, rid, trackId, view, }) {
    const session = getSession(view);
    const linkedFeatures = rid && baseUrl
        ? features.map(feature => addBlastResultLink(feature, { baseUrl, rid }))
        : features;
    if (appendToTrackId) {
        const existingTrack = findTrackConf({
            session,
            trackId: appendToTrackId,
            view,
        });
        if (existingTrack) {
            const existingFeatures = featuresFromTrack(existingTrack);
            const mergedFeatures = makeUniqueFeatureIds([
                ...existingFeatures,
                ...linkedFeatures,
            ]);
            updateTrackAdapter(existingTrack, mergedFeatures);
            reloadVisibleTrack(view, appendToTrackId);
            return;
        }
        throw new Error(`Could not find BLAST track to append to: ${appendToTrackId}`);
    }
    session.addTrackConf(blastTrackConf({
        assemblyNames: [assemblyName],
        blastProgram,
        features: linkedFeatures,
        name,
        trackId,
    }));
    view.showTrack(trackId);
}
export function getAppendableBlastTracks({ assemblyName, blastProgram, view, }) {
    try {
        const session = getSession(view);
        return trackConfs({ session, view })
            .filter(track => isAppendableBlastTrack(track, assemblyName, blastProgram))
            .map(track => ({
            name: stringConf(track, 'name') ||
                stringConf(track, 'trackId') ||
                'BLAST hits',
            trackId: stringConf(track, 'trackId') || '',
        }))
            .filter(track => track.trackId)
            .reverse();
    }
    catch {
        return [];
    }
}
function blastTrackConf({ assemblyNames, blastProgram, features, name, trackId, }) {
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
                    color1: "jexl:get(feature,'blastStatus') == 'no_hits' ? '#d99000' : get(feature,'blastStatus') == 'no_report' ? '#7c5cc4' : get(feature,'blastStatus') == 'no_sequence' ? '#5f6368' : get(feature,'blastRole') == 'query' ? '#8a8f98' : get(feature,'type') == 'gap' ? '#d99b00' : get(feature,'type') == 'mismatch' ? '#d62728' : get(feature,'blastCandidateClass') == 'longer subject match' ? '#d99000' : get(feature,'blastCandidateClass') == 'likely complete annotated homolog' ? '#2f8f46' : get(feature,'type') == 'CDS' || get(feature,'type') == 'match_part' ? '#4c78a8' : '#9ecae1'",
                    color2: "jexl:get(feature,'blastStatus') == 'no_hits' ? '#ffd166' : get(feature,'blastStatus') == 'no_report' ? '#c4b5fd' : get(feature,'blastStatus') == 'no_sequence' ? '#c7c9cc' : get(feature,'blastRole') == 'query' ? '#c1c7cf' : get(feature,'type') == 'gap' ? '#ffe08a' : get(feature,'type') == 'mismatch' ? '#ff9896' : get(feature,'blastCandidateClass') == 'longer subject match' ? '#ffd166' : get(feature,'blastCandidateClass') == 'likely complete annotated homolog' ? '#8fd19e' : get(feature,'type') == 'CDS' || get(feature,'type') == 'match_part' ? '#6baed6' : '#c6dbef'",
                    labels: {
                        name: "jexl:get(feature,'name') || get(feature,'id')",
                        description: "jexl:get(feature,'description') || get(feature,'note')",
                        descriptionColor: 'blue',
                    },
                },
            },
        ],
    };
}
function trackConfs({ session, view, }) {
    const seen = new Set();
    const tracks = [];
    const visibleTrackConfs = view.tracks.map(track => track.configuration);
    for (const source of [
        session.sessionTracks,
        session.tracks,
        visibleTrackConfs,
    ]) {
        if (!source) {
            continue;
        }
        for (const track of Array.from(source)) {
            const trackId = stringConf(track, 'trackId');
            if (!trackId || seen.has(trackId)) {
                continue;
            }
            seen.add(trackId);
            tracks.push(track);
        }
    }
    return tracks;
}
function findTrackConf({ session, trackId, view, }) {
    return (trackConfs({ session, view }).find(track => stringConf(track, 'trackId') === trackId) ??
        view.tracks.find(track => track.configuration.trackId === trackId)?.configuration);
}
function updateTrackAdapter(track, features) {
    const adapter = {
        type: 'FromConfigAdapter',
        features,
    };
    if (typeof track.setSubschema === 'function') {
        track.setSubschema('adapter', adapter);
        return;
    }
    track.adapter = adapter;
}
function reloadVisibleTrack(view, trackId) {
    const visibleTrack = view.tracks.find(track => track.configuration.trackId === trackId);
    if (!visibleTrack) {
        view.showTrack(trackId);
        return;
    }
    for (const display of visibleTrack.displays ?? []) {
        void display.reload?.();
    }
}
function isAppendableBlastTrack(track, assemblyName, blastProgram) {
    if (stringConf(track, 'type') !== 'FeatureTrack') {
        return false;
    }
    const category = arrayConf(track, 'category') ?? [];
    const metadata = objectConf(track, 'metadata');
    const name = stringConf(track, 'name').toUpperCase();
    const isBlastTrack = metadata?.blastTrack === true ||
        category.includes('BLAST') ||
        name.includes('BLAST');
    const sameProgram = metadata?.blastProgram === blastProgram ||
        name.includes(blastProgram.toUpperCase());
    if (!isBlastTrack || !sameProgram) {
        return false;
    }
    const assemblyNames = arrayConf(track, 'assemblyNames') ?? [];
    if (!assemblyNames.includes(assemblyName)) {
        return false;
    }
    const adapter = objectConf(track, 'adapter');
    if (adapter?.type !== 'FromConfigAdapter') {
        return false;
    }
    return isBlastTrack && sameProgram;
}
function featuresFromTrack(track) {
    const adapter = objectConf(track, 'adapter');
    return Array.isArray(adapter?.features)
        ? adapter.features
        : [];
}
function stringConf(track, slot) {
    const value = readSlot(track, slot);
    return typeof value === 'string' ? value : '';
}
function arrayConf(track, slot) {
    const value = readSlot(track, slot);
    return Array.isArray(value) ? value.filter(isString) : undefined;
}
function objectConf(track, slot) {
    const value = readSlot(track, slot);
    return value && typeof value === 'object'
        ? value
        : undefined;
}
function readSlot(track, slot) {
    try {
        return readConfObject(track, slot);
    }
    catch {
        return track[slot];
    }
}
function isString(value) {
    return typeof value === 'string';
}
function makeUniqueFeatureIds(features) {
    const seen = new Set();
    return features.map((feature, index) => makeUniqueFeatureId(feature, seen, index));
}
function makeUniqueFeatureId(feature, seen, index) {
    const fallbackId = `${feature.refName}_${feature.start}_${feature.end}_${index + 1}`;
    const uniqueId = uniqueFeatureId(String(feature.uniqueId || fallbackId), seen);
    return {
        ...feature,
        uniqueId,
        subfeatures: Array.isArray(feature.subfeatures)
            ? feature.subfeatures.map((subfeature, subIndex) => makeUniqueFeatureId(subfeature, seen, subIndex))
            : feature.subfeatures,
    };
}
function uniqueFeatureId(baseId, seen) {
    let nextId = baseId;
    let copyNumber = 2;
    while (seen.has(nextId)) {
        nextId = `${baseId}_copy_${copyNumber}`;
        copyNumber += 1;
    }
    seen.add(nextId);
    return nextId;
}
export function sanitizeTrackId(value) {
    return value.replaceAll(/[^A-Za-z0-9_.-]/g, '_');
}
function addBlastResultLink(feature, { baseUrl, rid, }) {
    return {
        ...feature,
        blastRid: rid,
        blastResultUrl: blastResultUrl({ baseUrl, rid }),
        subfeatures: Array.isArray(feature.subfeatures)
            ? feature.subfeatures.map(subfeature => addBlastResultLink(subfeature, { baseUrl, rid }))
            : feature.subfeatures,
    };
}
function blastResultUrl({ baseUrl, rid, }) {
    return `${baseUrl}?CMD=Get&RID=${encodeURIComponent(rid)}`;
}
