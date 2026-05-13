import { getContainingTrack, getSession } from '@jbrowse/core/util';
import ManageSearchIcon from '@mui/icons-material/ManageSearch';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import BlastProteinDialog from './components/BlastProteinDialog';
import BlastSelectionDialog from './components/BlastSelectionDialog';
import { setPluginPrecomputedBlastTables } from './utils/localBlast';
function isLinearBasicDisplay(elt) {
    return elt.name === 'LinearBasicDisplay';
}
function isLinearGenomeView(elt) {
    return elt.name === 'LinearGenomeView';
}
function extendDisplayStateModel(stateModel) {
    return stateModel.views((self) => {
        const superContextMenuItems = self.contextMenuItems;
        return {
            contextMenuItems() {
                const feature = self.contextMenuFeature;
                const track = getContainingTrack(self);
                const featureType = feature?.get('type');
                const canBlast = feature && ['gene', 'mRNA', 'transcript'].includes(featureType);
                const blastResultUrl = feature?.get('blastResultUrl');
                return [
                    ...superContextMenuItems(),
                    ...(blastResultUrl
                        ? [
                            {
                                label: 'Open NCBI BLAST result',
                                icon: OpenInNewIcon,
                                onClick: () => {
                                    globalThis.open(blastResultUrl, '_blank', 'noopener,noreferrer');
                                },
                            },
                        ]
                        : []),
                    ...(canBlast
                        ? [
                            {
                                label: 'BLAST protein and load track',
                                icon: ManageSearchIcon,
                                onClick: () => {
                                    try {
                                        getSession(track).queueDialog(handleClose => [
                                            BlastProteinDialog,
                                            {
                                                model: track,
                                                handleClose,
                                                feature,
                                            },
                                        ]);
                                    }
                                    catch (e) {
                                        getSession(track).notifyError('Failed to open BLAST dialog', e);
                                    }
                                },
                            },
                        ]
                        : []),
                ];
            },
        };
    });
}
function extendViewStateModel(stateModel) {
    return stateModel.views((self) => {
        const superRubberBandMenuItems = self.rubberBandMenuItems;
        return {
            rubberBandMenuItems() {
                return [
                    ...superRubberBandMenuItems(),
                    { type: 'divider' },
                    regionBlastMenuItem(self, 'blastp-genes'),
                    regionBlastMenuItem(self, 'blastn-region'),
                ];
            },
        };
    });
}
function regionBlastMenuItem(view, mode) {
    return {
        label: mode === 'blastp-genes'
            ? 'BLASTP genes in selection'
            : 'BLASTN selected region',
        icon: ManageSearchIcon,
        onClick: () => {
            try {
                if (!view.leftOffset || !view.rightOffset) {
                    throw new Error('No selected region was found');
                }
                const regions = view.getSelectedRegions(view.leftOffset, view.rightOffset);
                getSession(view).queueDialog(handleClose => [
                    BlastSelectionDialog,
                    {
                        model: view,
                        handleClose,
                        mode,
                        regions,
                    },
                ]);
            }
            catch (e) {
                getSession(view).notifyError('Failed to open BLAST dialog', e);
            }
        },
    };
}
export default function BlastProteinTrackF(pluginManager) {
    setPluginPrecomputedBlastTables(pluginManager);
    pluginManager.addToExtensionPoint('Core-extendPluggableElement', (elt) => {
        if (isLinearBasicDisplay(elt)) {
            elt.stateModel = extendDisplayStateModel(elt.stateModel);
        }
        else if (isLinearGenomeView(elt)) {
            elt.stateModel = extendViewStateModel(elt.stateModel);
        }
        return elt;
    });
}
