import { getConf } from '@jbrowse/core/configuration';
import { getSession } from '@jbrowse/core/util';
import { extractProteinSequence } from './featureSequence';
const codonTable = {
    TTT: 'F',
    TTC: 'F',
    TTA: 'L',
    TTG: 'L',
    TCT: 'S',
    TCC: 'S',
    TCA: 'S',
    TCG: 'S',
    TAT: 'Y',
    TAC: 'Y',
    TAA: '*',
    TAG: '*',
    TGT: 'C',
    TGC: 'C',
    TGA: '*',
    TGG: 'W',
    CTT: 'L',
    CTC: 'L',
    CTA: 'L',
    CTG: 'L',
    CCT: 'P',
    CCC: 'P',
    CCA: 'P',
    CCG: 'P',
    CAT: 'H',
    CAC: 'H',
    CAA: 'Q',
    CAG: 'Q',
    CGT: 'R',
    CGC: 'R',
    CGA: 'R',
    CGG: 'R',
    ATT: 'I',
    ATC: 'I',
    ATA: 'I',
    ATG: 'M',
    ACT: 'T',
    ACC: 'T',
    ACA: 'T',
    ACG: 'T',
    AAT: 'N',
    AAC: 'N',
    AAA: 'K',
    AAG: 'K',
    AGT: 'S',
    AGC: 'S',
    AGA: 'R',
    AGG: 'R',
    GTT: 'V',
    GTC: 'V',
    GTA: 'V',
    GTG: 'V',
    GCT: 'A',
    GCC: 'A',
    GCA: 'A',
    GCG: 'A',
    GAT: 'D',
    GAC: 'D',
    GAA: 'E',
    GAG: 'E',
    GGT: 'G',
    GGC: 'G',
    GGA: 'G',
    GGG: 'G',
};
export async function getProteinSequence({ feature, view, }) {
    const embeddedSequence = extractProteinSequence(feature);
    if (embeddedSequence) {
        return embeddedSequence;
    }
    const json = feature.toJSON();
    const cds = getBestCdsSet(json);
    if (!cds.length) {
        return undefined;
    }
    const sequence = await fetchFeatureSequence({ feature, view });
    return translateCds({
        cds,
        sequence,
        featureStart: json.start,
        strand: json.strand ?? 1,
    });
}
async function fetchFeatureSequence({ feature, view, }) {
    const session = getSession(view);
    const assemblyName = view.assemblyNames?.[0];
    if (!assemblyName) {
        throw new Error('No assembly is selected in this linear genome view');
    }
    const { assemblyManager, rpcManager } = session;
    const assembly = await assemblyManager.waitForAssembly(assemblyName);
    if (!assembly) {
        throw new Error(`Assembly not found: ${assemblyName}`);
    }
    const { start, end, refName } = feature.toJSON();
    const sessionId = 'blast-track-get-sequence';
    const feats = (await rpcManager.call(sessionId, 'CoreGetFeatures', {
        adapterConfig: getConf(assembly, ['sequence', 'adapter']),
        sessionId,
        regions: [
            {
                start,
                end,
                refName: assembly.getCanonicalRefName(refName),
                assemblyName,
            },
        ],
    }));
    return feats[0]?.get('seq') ?? '';
}
export function getBestCdsSet(feature) {
    const candidates = feature.type === 'mRNA' || feature.type === 'transcript'
        ? [feature]
        : (feature.subfeatures?.filter(sub => sub.type === 'mRNA' || sub.type === 'transcript') ?? []);
    const transcriptCandidates = candidates.length ? candidates : [feature];
    return transcriptCandidates
        .map(candidate => collectCds(candidate))
        .filter(cds => cds.length)
        .sort((a, b) => cdsLength(b) - cdsLength(a))[0] ?? [];
}
function collectCds(feature) {
    const subs = feature.subfeatures ?? [];
    return [
        ...(feature.type === 'CDS' ? [feature] : []),
        ...subs.flatMap(sub => collectCds(sub)),
    ];
}
function translateCds({ cds, sequence, featureStart, strand, }) {
    const sortedCds = [...cds].sort((a, b) => a.start - b.start);
    const stitched = sortedCds
        .map(sub => sequence.slice(sub.start - featureStart, sub.end - featureStart))
        .join('');
    const codingSequence = strand === -1 ? revcom(stitched) : stitched;
    let protein = '';
    for (let i = 0; i < codingSequence.length - 2; i += 3) {
        protein += codonTable[codingSequence.slice(i, i + 3).toUpperCase()] ?? 'X';
    }
    return protein.replace(/\*$/, '');
}
function cdsLength(cds) {
    return cds.reduce((total, sub) => total + sub.end - sub.start, 0);
}
function revcom(sequence) {
    const complement = {
        A: 'T',
        C: 'G',
        G: 'C',
        T: 'A',
        U: 'A',
        a: 't',
        c: 'g',
        g: 'c',
        t: 'a',
        u: 'a',
        N: 'N',
        n: 'n',
    };
    return [...sequence]
        .reverse()
        .map(base => complement[base] ?? 'N')
        .join('')
        .toUpperCase();
}
