import type { SelectedRegion } from '../utils/regionData';
import type { LinearGenomeViewModel } from '@jbrowse/plugin-linear-genome-view';
export type SelectionBlastMode = 'blastn-region' | 'blastp-genes' | 'tblastx-region';
export default function BlastSelectionDialog({ handleClose, mode, model, regions, }: {
    handleClose: () => void;
    mode: SelectionBlastMode;
    model: LinearGenomeViewModel;
    regions: SelectedRegion[];
}): import("react/jsx-runtime").JSX.Element;
