import { defineCatalog, starterComponents } from '@tessera/catalog';
import { pullRequest } from './pullRequest';

/** Shared by the page (rendering, local compiles) and the dev-server endpoint (streaming compiles). */
export const catalog = defineCatalog([...starterComponents, pullRequest]);
