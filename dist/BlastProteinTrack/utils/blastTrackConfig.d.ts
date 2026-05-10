import type { LinearGenomeViewModel } from '@jbrowse/plugin-linear-genome-view';
export interface FromConfigFeature {
    uniqueId: string;
    refName: string;
    start: number;
    end: number;
    type: string;
    name: string;
    score?: number;
    strand?: number;
    [key: string]: unknown;
}
export declare function addBlastFeatureTrack({ assemblyName, baseUrl, features, name, rid, trackId, view, }: {
    assemblyName: string;
    baseUrl?: string;
    features: FromConfigFeature[];
    name: string;
    rid?: string;
    trackId: string;
    view: LinearGenomeViewModel;
}): void;
export declare function sanitizeTrackId(value: string): string;
