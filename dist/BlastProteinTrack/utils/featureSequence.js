const sequenceAttributes = [
    'protein_sequence',
    'proteinSequence',
    'translation',
    'translated_sequence',
    'seq',
];
export function extractProteinSequence(feature) {
    for (const attribute of sequenceAttributes) {
        const value = feature.get(attribute);
        const sequence = normalizeSequenceValue(value);
        if (sequence) {
            return sequence;
        }
    }
    return undefined;
}
export function getFeatureName(feature) {
    return (feature.get('name') ??
        feature.get('gene_name') ??
        feature.get('gene_id') ??
        feature.get('id') ??
        feature.id());
}
function normalizeSequenceValue(value) {
    const sequence = Array.isArray(value) ? value[0] : value;
    return typeof sequence === 'string'
        ? sequence.replaceAll(/\s/g, '').toUpperCase()
        : undefined;
}
