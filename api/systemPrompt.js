// Backward-compatible entry point. Keep one prompt implementation so recipe
// routing rules cannot drift between providers.
export { buildSystemMessage } from "./buildSystemMessage";
