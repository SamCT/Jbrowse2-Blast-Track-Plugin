import { getConf, readConfObject } from '@jbrowse/core/configuration';
import { getSession } from '@jbrowse/core/util';
export async function fetchRegionSequence({ region, view, }) {
    const session = getSession(view);
    const assembly = await session.assemblyManager.waitForAssembly(region.assemblyName);
    if (!assembly) {
        throw new Error(`Assembly not found: ${region.assemblyName}`);
    }
    const canonicalRefName = assembly.getCanonicalRefName2(region.refName);
    const sessionId = 'blast-track-region-sequence';
    const features = (await session.rpcManager.call(sessionId, 'CoreGetFeatures', {
        adapterConfig: getConf(assembly, ['sequence', 'adapter']),
        sessionId,
        regions: [
            {
                ...region,
                refName: assembly.getSeqAdapterRefName(canonicalRefName),
            },
        ],
    }));
    return features
        .map(feature => feature.get('seq'))
        .filter((seq) => typeof seq === 'string')
        .join('');
}
export async function fetchBlastableGenes({ region, view, }) {
    return getRenderedBlastableGenes({ region, view });
}
function getRenderedBlastableGenes({ region, view, }) {
    const maybeView = view;
    const featuresById = new Map();
    for (const track of maybeView.tracks ?? []) {
        if (!isRenderedCandidateFeatureTrack(track, region.assemblyName)) {
            continue;
        }
        for (const display of track.displays ?? []) {
            const values = display.features?.values;
            if (typeof values !== 'function') {
                continue;
            }
            for (const feature of values.call(display.features)) {
                if (!feature ||
                    !isBlastableGeneFeature(feature) ||
                    !overlapsRegion(feature, region)) {
                    continue;
                }
                featuresById.set(featureKey(feature), feature);
            }
        }
    }
    return [...featuresById.values()].sort((a, b) => a.get('start') - b.get('start'));
}
function isRenderedCandidateFeatureTrack(track, assemblyName) {
    if (track.type !== 'FeatureTrack' || !track.configuration) {
        return false;
    }
    const category = readOptionalConf(track.configuration, 'category');
    if (Array.isArray(category) && category.includes('BLAST')) {
        return false;
    }
    const assemblyNames = readOptionalConf(track.configuration, 'assemblyNames');
    return !assemblyNames?.length || assemblyNames.includes(assemblyName);
}
export function regionLabel(region) {
    return `${region.refName}:${region.start + 1}-${region.end}`;
}
function isBlastableGeneFeature(feature) {
    return ['gene', 'mRNA', 'transcript'].includes(feature.get('type'));
}
function overlapsRegion(feature, region) {
    const start = feature.get('start');
    const end = feature.get('end');
    const refName = feature.get('refName');
    return refName === region.refName && start < region.end && end > region.start;
}
function featureKey(feature) {
    return [
        feature.id(),
        feature.get('refName'),
        feature.get('start'),
        feature.get('end'),
    ].join(':');
}
function readOptionalConf(config, path) {
    try {
        return readConfObject(config, path);
    }
    catch {
        return undefined;
    }
}
