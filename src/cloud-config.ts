import type { FirebaseOptions } from "firebase/app";

// Firebase web app config for cloud save: Firebase console → Project settings →
// Your apps → Web app → "SDK setup and configuration" → Config.
// These values only identify the project (access is guarded by firestore.rules), so they
// are safe to commit. While this is null, the game hides cloud save and works offline.
export const CLOUD_CONFIG: FirebaseOptions | null = null;
