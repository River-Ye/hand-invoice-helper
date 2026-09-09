import { legacyInvoiceURL } from './tool-common.mjs';
const destination = legacyInvoiceURL(location.search, location.hash);
if (destination) location.replace(destination);
