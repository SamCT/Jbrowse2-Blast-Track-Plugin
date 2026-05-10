import type { Feature } from '@jbrowse/core/util';
import type { LinearGenomeViewModel } from '@jbrowse/plugin-linear-genome-view';
export interface SelectedRegion {
    assemblyName: string;
    refName: string;
    start: number;
    end: number;
}
export declare function fetchRegionSequence({ region, view, }: {
    region: SelectedRegion;
    view: LinearGenomeViewModel;
}): Promise<string>;
export declare function fetchBlastableGenes({ region, view, }: {
    region: SelectedRegion;
    view: LinearGenomeViewModel;
}): Promise<Feature[]>;
export declare function regionLabel(region: SelectedRegion): string;
