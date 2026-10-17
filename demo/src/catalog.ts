import { defineCatalog } from '@tessera/catalog';

/** Shared by the page (rendering, local compiles) and the dev-server endpoint (streaming compiles). */
export const catalog = defineCatalog();
