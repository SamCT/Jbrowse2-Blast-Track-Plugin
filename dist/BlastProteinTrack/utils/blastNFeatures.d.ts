import type { FromConfigFeature } from './blastTrackConfig';
import type { SelectedRegion } from './regionData';
import type { BlastHit } from './types';
export declare function featuresFromBlastNHits({ blastProgram, hitLimit, hspLimit, hits, idPrefix, queryLength, region, showMismatchMarkers, }: {
    blastProgram?: 'blastn' | 'tblastx';
    hitLimit: number;
    hspLimit: number;
    hits: BlastHit[];
    idPrefix?: string;
    queryLength: number;
    region: SelectedRegion;
    showMismatchMarkers: boolean;
}): FromConfigFeature[];
