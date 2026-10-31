import { router } from "expo-router";

/** Open the receipt / statement import screen. */
export const openImports = () => router.push("/imports");
/** Open one import's review screen. */
export const openImport = (id: string) => router.push({ pathname: "/imports/[id]", params: { id } });
