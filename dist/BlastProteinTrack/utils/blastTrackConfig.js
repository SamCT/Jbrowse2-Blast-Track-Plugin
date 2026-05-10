import { readConfObject } from '@jbrowse/core/configuration';
import { getSession } from '@jbrowse/core/util';
export function addBlastFeatureTrack({ appendToTrackId, assemblyName, baseUrl, blastProgram, features, name, rid, trackId, view, }) {
    const session = getSession(view);
    const linkedFeatures = rid && baseUrl
        ? features.map(feature => addBlastResultLink(feature, { baseUrl, rid }))
        : features;
    if (appendToTrackId) {
        const existingTrack = findTrackConf(session, appendToTrackId);
        if (existingTrack) {
            const existingFeatures = featuresFromTrack(existingTrack);
            const mergedFeatures = makeUniqueFeatureIds([
                ...existingFeatures,
                ...linkedFeatures,
            ]);
            const existingName = stringConf(existingTrack, 'name') || name || appendToTrackId;
            const existingAssemblyNames = arrayConf(existingTrack, 'assemblyNames') || [assemblyName];
            hideVisibleTrack(view, appendToTrackId);
            session.deleteTrackConf?.(existingTrack);
            session.addTrackConf(blastTrackConf({
                assemblyNames: existingAssemblyNames,
                blastProgram,
                features: mergedFeatures,
                name: existingName,
                trackId: appendToTrackId,
            }));
            view.showTrack(appendToTrackId);
            return;
        }
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
        return trackConfs(session)
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
                    color1: "jexl:get(feature,'blastStatus') == 'no_hits' ? '#d99000' : get(feature,'blastStatus') == 'no_report' ? '#7c5cc4' : get(feature,'blastStatus') == 'no_sequence' ? '#5f6368' : get(feature,'blastRole') == 'query' ? '#8a8f98' : get(feature,'type') == 'mismatch' || get(feature,'type') == 'gap' ? '#d62728' : get(feature,'type') == 'CDS' || get(feature,'type') == 'match_part' ? '#4c78a8' : '#9ecae1'",
                    color2: "jexl:get(feature,'blastStatus') == 'no_hits' ? '#ffd166' : get(feature,'blastStatus') == 'no_report' ? '#c4b5fd' : get(feature,'blastStatus') == 'no_sequence' ? '#c7c9cc' : get(feature,'blastRole') == 'query' ? '#c1c7cf' : get(feature,'type') == 'mismatch' || get(feature,'type') == 'gap' ? '#ff9896' : get(feature,'type') == 'CDS' || get(feature,'type') == 'match_part' ? '#6baed6' : '#c6dbef'",
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
function trackConfs(session) {
    const source = session.sessionTracks ?? session.tracks;
    return source ? Array.from(source) : [];
}
function findTrackConf(session, trackId) {
    return trackConfs(session).find(track => stringConf(track, 'trackId') === trackId);
}
function isAppendableBlastTrack(track, assemblyName, blastProgram) {
    if (stringConf(track, 'type') !== 'FeatureTrack') {
        return false;
    }
    const adapter = objectConf(track, 'adapter');
    if (adapter?.type !== 'FromConfigAdapter') {
        return false;
    }
    const assemblyNames = arrayConf(track, 'assemblyNames') ?? [];
    if (!assemblyNames.includes(assemblyName)) {
        return false;
    }
    const category = arrayConf(track, 'category') ?? [];
    const metadata = objectConf(track, 'metadata');
    const name = stringConf(track, 'name').toUpperCase();
    const features = featuresFromTrack(track);
    const featureProgram = features.find(feature => typeof feature.blastProgram === 'string')?.blastProgram;
    const isBlastTrack = metadata?.blastTrack === true ||
        category.includes('BLAST') ||
        name.includes('BLAST');
    const sameProgram = metadata?.blastProgram === blastProgram ||
        featureProgram === blastProgram ||
        name.includes(blastProgram.toUpperCase());
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
function hideVisibleTrack(view, trackId) {
    if (view.tracks.some(track => track.configuration.trackId === trackId)) {
        view.hideTrack(trackId);
    }
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
