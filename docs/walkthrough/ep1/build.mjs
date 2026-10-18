// Builds episode 1: real code lines and the 15-frame SSE capture from the demo's fake model.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEpisode, readCapture } from '../series/build-lib.mjs';
import * as script from './script.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const frames = readCapture(join(here, 'capture.txt'));
if (frames.length !== 15) throw new Error(`expected 15 frames, got ${frames.length}`);
buildEpisode({ outFile: join(here, 'tessera-ep1.html'), script, extra: { frames } });
