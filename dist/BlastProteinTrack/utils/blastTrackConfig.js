import { getSession } from '@jbrowse/core/util';
export function addBlastFeatureTrack({ assemblyName, baseUrl, features, name, rid, trackId, view, }) {
    const session = getSession(view);
    session.addTrackConf({
        type: 'FeatureTrack',
        trackId,
        name,
        assemblyNames: [assemblyName],
        category: ['BLAST'],
        adapter: {
            type: 'FromConfigAdapter',
            features: rid && baseUrl
                ? features.map(feature => addBlastResultLink(feature, { baseUrl, rid }))
                : features,
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
    });
    view.showTrack(trackId);
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
