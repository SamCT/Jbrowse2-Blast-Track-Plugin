import { getContainingTrack, getSession } from '@jbrowse/core/util'
import ManageSearchIcon from '@mui/icons-material/ManageSearch'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'

import BlastProteinDialog from './components/BlastProteinDialog'
import BlastSelectionDialog, {
  type SelectionBlastMode,
} from './components/BlastSelectionDialog'

import type PluginManager from '@jbrowse/core/PluginManager'
import type { PluggableElementType } from '@jbrowse/core/pluggableElementTypes'
import type DisplayType from '@jbrowse/core/pluggableElementTypes/DisplayType'
import type ViewType from '@jbrowse/core/pluggableElementTypes/ViewType'
import type { MenuItem } from '@jbrowse/core/ui'
import type { Feature } from '@jbrowse/core/util'
import type { IAnyModelType } from '@jbrowse/mobx-state-tree'
import type { LinearGenomeViewModel } from '@jbrowse/plugin-linear-genome-view'

function isLinearBasicDisplay(elt: { name: string }): elt is DisplayType {
  return elt.name === 'LinearBasicDisplay'
}

function isLinearGenomeView(elt: { name: string }): elt is ViewType {
  return elt.name === 'LinearGenomeView'
}

function extendDisplayStateModel(stateModel: IAnyModelType) {
  return stateModel.views(
    (self: {
      contextMenuItems: () => MenuItem[]
      contextMenuFeature?: Feature
    }) => {
      const superContextMenuItems = self.contextMenuItems
      return {
        contextMenuItems() {
          const feature = self.contextMenuFeature
          const track = getContainingTrack(self)
          const featureType = feature?.get('type')
          const canBlast =
            feature && ['gene', 'mRNA', 'transcript'].includes(featureType)
          const blastResultUrl = feature?.get('blastResultUrl') as
            | string
            | undefined

          return [
            ...superContextMenuItems(),
            ...(blastResultUrl
              ? [
                  {
                    label: 'Open NCBI BLAST result',
                    icon: OpenInNewIcon,
                    onClick: () => {
                      globalThis.open(
                        blastResultUrl,
                        '_blank',
                        'noopener,noreferrer',
                      )
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
                        ])
                      } catch (e) {
                        getSession(track).notifyError(
                          'Failed to open BLAST dialog',
                          e,
                        )
                      }
                    },
                  },
                ]
              : []),
          ]
        },
      }
    },
  )
}

function extendViewStateModel(stateModel: IAnyModelType) {
  return stateModel.views((self: LinearGenomeViewModel) => {
    const superRubberBandMenuItems = self.rubberBandMenuItems
    return {
      rubberBandMenuItems() {
        return [
          ...superRubberBandMenuItems(),
          { type: 'divider' as const },
          regionBlastMenuItem(self, 'blastp-genes'),
          regionBlastMenuItem(self, 'blastn-region'),
        ]
      },
    }
  })
}

function regionBlastMenuItem(
  view: LinearGenomeViewModel,
  mode: SelectionBlastMode,
): MenuItem {
  return {
    label:
      mode === 'blastp-genes'
        ? 'BLASTP genes in selection'
        : 'BLASTN selected region',
    icon: ManageSearchIcon,
    onClick: () => {
      try {
        if (!view.leftOffset || !view.rightOffset) {
          throw new Error('No selected region was found')
        }
        const regions = view.getSelectedRegions(view.leftOffset, view.rightOffset)
        getSession(view).queueDialog(handleClose => [
          BlastSelectionDialog,
          {
            model: view,
            handleClose,
            mode,
            regions,
          },
        ])
      } catch (e) {
        getSession(view).notifyError('Failed to open BLAST dialog', e)
      }
    },
  }
}

export default function BlastProteinTrackF(pluginManager: PluginManager) {
  pluginManager.addToExtensionPoint(
    'Core-extendPluggableElement',
    (elt: PluggableElementType) => {
      if (isLinearBasicDisplay(elt)) {
        elt.stateModel = extendDisplayStateModel(elt.stateModel)
      } else if (isLinearGenomeView(elt)) {
        elt.stateModel = extendViewStateModel(elt.stateModel)
      }
      return elt
    },
  )
}
