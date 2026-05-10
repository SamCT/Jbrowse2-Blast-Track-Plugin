import Plugin from '@jbrowse/core/Plugin'

import BlastProteinTrackF from './BlastProteinTrack'
import { version } from './version'

import type PluginManager from '@jbrowse/core/PluginManager'

export default class BlastTrackPlugin extends Plugin {
  name = 'BlastTrack'
  version = version

  install(pluginManager: PluginManager) {
    BlastProteinTrackF(pluginManager)
  }
}
