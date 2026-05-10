import Plugin from '@jbrowse/core/Plugin';
import BlastProteinTrackF from './BlastProteinTrack';
import { version } from './version';
export default class BlastTrackPlugin extends Plugin {
    name = 'BlastTrack';
    version = version;
    install(pluginManager) {
        BlastProteinTrackF(pluginManager);
    }
}
