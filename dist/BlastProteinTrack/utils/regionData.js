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
    const session = getSession(view);
    const trackConfs = getTrackConfs(session);
    const featuresById = new Map();
    for (const trackConf of trackConfs) {
        if (!isCandidateFeatureTrack(trackConf, region.assemblyName)) {
            continue;
        }
        const adapterConfig = readConfObject(trackConf, 'adapter');
        const sessionId = `blast-track-region-features-${readConfObject(trackConf, 'trackId')}`;
        const features = (await session.rpcManager.call(sessionId, 'CoreGetFeatures', {
            adapterConfig,
            sessionId,
            regions: [region],
        }));
        for (const feature of features) {
            if (!isBlastableGeneFeature(feature) || !overlapsRegion(feature, region)) {
                continue;
            }
            featuresById.set(featureKey(feature), feature);
        }
    }
    return [...featuresById.values()].sort((a, b) => a.get('start') - b.get('start'));
}
function getTrackConfs(session) {
    const maybeSession = session;
    const assemblies = (maybeSession.jbrowse?.assemblies ??
        []);
    const temporaryAssemblies = (maybeSession.temporaryAssemblies ??
        []);
    return [
        ...(maybeSession.jbrowse?.tracks ?? []),
        ...(maybeSession.sessionTracks ?? []),
        ...assemblies.flatMap(assembly => assembly.sequence ?? []),
        ...temporaryAssemblies.flatMap(assembly => assembly.sequence ?? []),
        ...(maybeSession.connectionInstances ?? []).flatMap(connection => connection.tracks ?? []),
    ];
}
export function regionLabel(region) {
    return `${region.refName}:${region.start + 1}-${region.end}`;
}
function isCandidateFeatureTrack(trackConf, assemblyName) {
    if (readConfObject(trackConf, 'type') !== 'FeatureTrack') {
        return false;
    }
    const adapterConfig = readConfObject(trackConf, 'adapter');
    if (!adapterConfig || adapterConfig.type === 'FromConfigAdapter') {
        return false;
    }
    const category = readConfObject(trackConf, 'category');
    if (Array.isArray(category) && category.includes('BLAST')) {
        return false;
    }
    const assemblyNames = readConfObject(trackConf, 'assemblyNames');
    return !assemblyNames?.length || assemblyNames.includes(assemblyName);
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
