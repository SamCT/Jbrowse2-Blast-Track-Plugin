import type { LinearGenomeViewModel } from '@jbrowse/plugin-linear-genome-view';
export type BlastTrackProgram = 'blastp' | 'blastn' | 'tblastx';
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
export interface AppendableBlastTrack {
    name: string;
    trackId: string;
}
export declare function addBlastFeatureTrack({ appendToTrackId, assemblyName, baseUrl, blastProgram, features, name, rid, trackId, view, }: {
    appendToTrackId?: string;
    assemblyName: string;
    baseUrl?: string;
    blastProgram?: BlastTrackProgram;
    features: FromConfigFeature[];
    name: string;
    rid?: string;
    trackId: string;
    view: LinearGenomeViewModel;
}): void;
export declare function getAppendableBlastTracks({ assemblyName, blastProgram, view, }: {
    assemblyName: string;
    blastProgram: BlastTrackProgram;
    view: LinearGenomeViewModel;
}): AppendableBlastTrack[];
export declare function sanitizeTrackId(value: string): string;
