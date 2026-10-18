// Builds episode 6 on the v2 player.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEpisode } from '../series/build-lib.mjs';
import * as script from './script.mjs';

const here = dirname(fileURLToPath(import.meta.url));
buildEpisode({ outFile: join(here, 'tessera-ep6.html'), script });
