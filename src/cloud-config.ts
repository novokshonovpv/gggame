import type { FirebaseOptions } from "firebase/app";

// Firebase web app config for cloud save: Firebase console → Project settings →
// Your apps → Web app → "SDK setup and configuration" → Config.
// These values only identify the project (access is guarded by firestore.rules), so they
// are safe to commit. While this is null, the game hides cloud save and works offline.
export const CLOUD_CONFIG: FirebaseOptions | null = {
  apiKey: "AIzaSyBwUELyF4vCDDN1Zgliwud2S80nlDw6Fhw",
  authDomain: "moto-aaf82.firebaseapp.com",
  projectId: "moto-aaf82",
  storageBucket: "moto-aaf82.firebasestorage.app",
  messagingSenderId: "764140787685",
  appId: "1:764140787685:web:e46660443e84fe7cb5410c",
};
