import { getConf, readConfObject } from '@jbrowse/core/configuration';
import { getSession, SimpleFeature } from '@jbrowse/core/util';
import { extractProteinSequence } from './featureSequence';
import { getBestCdsSet } from './proteinFromCds';
export async function fetchRegionSequence({ region, view, }) {
    const session = getSession(view);
    const assembly = await session.assemblyManager.waitForAssembly(region.assemblyName);
    if (!assembly) {
        throw new Error(`Assembly not found: ${region.assemblyName}`);
    }
    const sequenceRefName = getSequenceRefName(assembly, region.refName);
    const sessionId = 'blast-track-region-sequence';
    const features = (await session.rpcManager.call(sessionId, 'CoreGetFeatures', {
        adapterConfig: getConf(assembly, ['sequence', 'adapter']),
        sessionId,
        regions: [
            {
                ...region,
                refName: sequenceRefName,
            },
        ],
    }));
    return features
        .map(feature => feature.get('seq'))
        .filter((seq) => typeof seq === 'string')
        .join('');
}
function getSequenceRefName(assembly, refName) {
    const canonicalRefName = callAssemblyRefNameMethod(assembly, 'getCanonicalRefName2', refName) ??
        callAssemblyRefNameMethod(assembly, 'getCanonicalRefName', refName) ??
        refName;
    return (callAssemblyRefNameMethod(assembly, 'getSeqAdapterRefName', canonicalRefName) ?? canonicalRefName);
}
function callAssemblyRefNameMethod(assembly, method, refName) {
    const mapper = assembly[method];
    if (typeof mapper !== 'function') {
        return undefined;
    }
    try {
        return mapper.call(assembly, refName) || undefined;
    }
    catch {
        return undefined;
    }
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
    return deduplicateBlastableGenes([...featuresById.values()]).sort(compareFeatureStart);
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
function deduplicateBlastableGenes(features) {
    const sortedFeatures = [...features].sort(compareFeatureStart);
    const geneFeatures = sortedFeatures.filter(feature => featureType(feature) === 'gene');
    const representatives = new Map();
    for (const renderedFeature of sortedFeatures) {
        const feature = longestIsoformFeature(renderedFeature);
        const key = featureGroupKey(feature, geneFeatures);
        const existing = representatives.get(key);
        if (!existing || betterBlastRepresentative(feature, existing)) {
            representatives.set(key, feature);
        }
    }
    return [...representatives.values()];
}
function longestIsoformFeature(feature) {
    if (featureType(feature) !== 'gene') {
        return feature;
    }
    const transcript = longestTranscriptSubfeature(feature);
    return transcript ? transcriptSubfeatureToFeature(feature, transcript) : feature;
}
function longestTranscriptSubfeature(feature) {
    const transcripts = transcriptSubfeatures(feature.toJSON());
    return transcripts
        .filter(transcript => estimatedJsonProteinLength(transcript) > 0)
        .sort((a, b) => estimatedJsonProteinLength(b) - estimatedJsonProteinLength(a) ||
        featureJsonLength(b) - featureJsonLength(a))[0];
}
function transcriptSubfeatures(feature) {
    return (feature.subfeatures ?? []).flatMap(subfeature => {
        const json = subfeature;
        return [
            ...(isTranscriptFeatureType(json.type) ? [json] : []),
            ...transcriptSubfeatures(json),
        ];
    });
}
function transcriptSubfeatureToFeature(parent, transcript) {
    const parentJson = parent.toJSON();
    const inheritedGeneId = jsonValue(transcript, 'gene_id') ??
        jsonValue(transcript, 'Parent') ??
        rawFeatureIdentity(parent) ??
        parent.id();
    const transcriptId = jsonValue(transcript, 'ID') ??
        jsonValue(transcript, 'id') ??
        jsonValue(transcript, 'Name') ??
        transcript.uniqueId ??
        `${transcript.start}-${transcript.end}`;
    return new SimpleFeature({
        id: `${parent.id()}-${String(transcriptId)}`,
        parent,
        data: {
            ...transcript,
            refName: transcript.refName ?? parentJson.refName,
            strand: transcript.strand ?? parentJson.strand,
            gene_id: inheritedGeneId,
            blastParentGeneId: parent.id(),
            blastParentGeneName: rawFeatureIdentity(parent),
        },
    });
}
function isTranscriptOfGene(feature, gene) {
    if (!containsFeature(gene, feature)) {
        return false;
    }
    if (sharesGeneIdentity(feature, gene)) {
        return true;
    }
    const parentIds = geneParentIds(feature);
    const geneIds = geneIdentityValues(gene);
    if (parentIds.length && geneIds.length) {
        return parentIds.some(parentId => geneIds.includes(parentId));
    }
    return featureStrand(feature) === featureStrand(gene);
}
function betterBlastRepresentative(candidate, existing) {
    const candidateProteinLength = estimatedProteinLength(candidate);
    const existingProteinLength = estimatedProteinLength(existing);
    if (candidateProteinLength !== existingProteinLength) {
        return candidateProteinLength > existingProteinLength;
    }
    const candidatePriority = featureTypePriority(candidate);
    const existingPriority = featureTypePriority(existing);
    if (candidatePriority !== existingPriority) {
        return candidatePriority < existingPriority;
    }
    return featureLength(candidate) > featureLength(existing);
}
function featureTypePriority(feature) {
    if (isTranscriptFeatureType(featureType(feature))) {
        return 0;
    }
    return 1;
}
function featureGroupKey(feature, geneFeatures) {
    const containingGene = featureType(feature) === 'gene'
        ? undefined
        : geneFeatures.find(gene => isTranscriptOfGene(feature, gene));
    if (containingGene) {
        const identity = geneIdentityValues(containingGene)[0] ?? geneParentIds(feature)[0];
        return identity
            ? `${featureRefName(feature)}:${identity}`
            : featureKey(containingGene);
    }
    const identity = geneParentIds(feature)[0] ?? geneIdentityValues(feature)[0];
    return identity
        ? `${featureRefName(feature)}:${identity}`
        : featureKey(feature);
}
function estimatedProteinLength(feature) {
    const embeddedSequence = extractProteinSequence(feature);
    if (embeddedSequence) {
        return embeddedSequence.replaceAll(/[^A-Za-z*]/g, '').length;
    }
    const cds = getBestCdsSet(feature.toJSON());
    return Math.floor(cds.reduce((total, sub) => total + sub.end - sub.start, 0) / 3);
}
function estimatedJsonProteinLength(feature) {
    const embeddedSequence = extractJsonProteinSequence(feature);
    if (embeddedSequence) {
        return embeddedSequence.replaceAll(/[^A-Za-z*]/g, '').length;
    }
    const cds = getBestCdsSet(feature);
    return Math.floor(cds.reduce((total, sub) => total + sub.end - sub.start, 0) / 3);
}
function extractJsonProteinSequence(feature) {
    for (const attribute of [
        'protein_sequence',
        'proteinSequence',
        'translation',
        'translated_sequence',
        'seq',
    ]) {
        const sequence = normalizeJsonSequenceValue(jsonValue(feature, attribute));
        if (sequence) {
            return sequence;
        }
    }
    return undefined;
}
function normalizeJsonSequenceValue(value) {
    const sequence = Array.isArray(value) ? value[0] : value;
    return typeof sequence === 'string'
        ? sequence.replaceAll(/\s/g, '').toUpperCase()
        : undefined;
}
function containsFeature(container, feature) {
    return (featureRefName(container) === featureRefName(feature) &&
        featureStart(container) <= featureStart(feature) &&
        featureEnd(container) >= featureEnd(feature));
}
function sharesGeneIdentity(a, b) {
    const aValues = geneIdentityValues(a);
    const bValues = geneIdentityValues(b);
    return aValues.some(value => bValues.includes(value));
}
function geneParentIds(feature) {
    return normalizeFeatureValues(feature.get('Parent') ??
        feature.get('parent') ??
        feature.get('parents') ??
        feature.get('transcript_parent') ??
        feature.get('gene_id'));
}
function geneIdentityValues(feature) {
    return [
        ...[
            'ID',
            'id',
            'gene_id',
            'gene_name',
            'locus_tag',
            'Name',
            'name',
        ].flatMap(attribute => normalizeFeatureValues(feature.get(attribute))),
        feature.id(),
    ]
        .map(normalizeFeatureIdentity)
        .filter((value) => Boolean(value));
}
function normalizeFeatureValues(value) {
    if (Array.isArray(value)) {
        return value.flatMap(normalizeFeatureValues);
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
        return [];
    }
    return String(value)
        .split(',')
        .map(normalizeFeatureIdentity)
        .filter((entry) => Boolean(entry));
}
function normalizeFeatureIdentity(value) {
    return typeof value === 'string'
        ? value
            .replace(/^(gene|mrna|transcript)[:_-]/i, '')
            .replace(/\.(?:mrna|transcript|t|isoform)\d+$/i, '')
            .trim()
            .toLowerCase()
        : undefined;
}
function rawFeatureIdentity(feature) {
    return (feature.get('ID') ??
        feature.get('id') ??
        feature.get('gene_id') ??
        feature.get('gene_name') ??
        feature.get('locus_tag') ??
        feature.get('Name') ??
        feature.get('name'));
}
function jsonValue(feature, attribute) {
    const value = feature[attribute];
    if (value !== undefined) {
        return value;
    }
    const attributes = feature.attributes;
    return attributes && typeof attributes === 'object'
        ? attributes[attribute]
        : undefined;
}
function isTranscriptFeatureType(type) {
    return type === 'mRNA' || type === 'transcript';
}
function compareFeatureStart(a, b) {
    return featureStart(a) - featureStart(b);
}
function featureType(feature) {
    return feature.get('type');
}
function featureRefName(feature) {
    return feature.get('refName');
}
function featureStart(feature) {
    return feature.get('start');
}
function featureEnd(feature) {
    return feature.get('end');
}
function featureStrand(feature) {
    return feature.get('strand') ?? 0;
}
function featureLength(feature) {
    return featureEnd(feature) - featureStart(feature);
}
function featureJsonLength(feature) {
    return feature.end - feature.start;
}
function overlapsRegion(feature, region) {
    const start = featureStart(feature);
    const end = featureEnd(feature);
    const refName = featureRefName(feature);
    return refName === region.refName && start < region.end && end > region.start;
}
function featureKey(feature) {
    return [
        feature.id(),
        featureRefName(feature),
        featureStart(feature),
        featureEnd(feature),
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
