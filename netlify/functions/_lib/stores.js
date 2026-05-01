// Nombres canónicos de los stores de Netlify Blobs y getters con
// `consistency: "strong"` (necesario para CAS, lecturas tras-escritura
// y para que el long-poll del worker no vea estado obsoleto).

import { getStore } from "@netlify/blobs";

export const ACTIVE = "jobs-active";
export const ARCHIVE = "jobs-archive";
export const CHUNKS = "jobs-chunks";
export const LEGACY = "jobs";

export const getActive = () => getStore({ name: ACTIVE, consistency: "strong" });
export const getArchive = () => getStore({ name: ARCHIVE, consistency: "strong" });
export const getChunks = () => getStore({ name: CHUNKS, consistency: "strong" });
