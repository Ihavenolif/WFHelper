import en from "./en.json";

// The catalogues are data files so translators never touch TypeScript; this
// shim is only here to turn en.json into the MessageKey union.
export type MessageKey = keyof typeof en;

export { en };
