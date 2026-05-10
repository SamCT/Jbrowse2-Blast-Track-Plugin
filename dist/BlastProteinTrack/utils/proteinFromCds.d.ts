import type { Feature } from '@jbrowse/core/util';
export interface JsonFeature {
    start: number;
    end: number;
    type?: string;
    strand?: number;
    refName?: string;
    subfeatures?: JsonFeature[];
}
export declare function getProteinSequence({ feature, view, }: {
    feature: Feature;
    view: {
        assemblyNames?: string[];
    };
}): Promise<string | undefined>;
export declare function getBestCdsSet(feature: JsonFeature): JsonFeature[];
