import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCqjR5zQGbDTsrTBkCHuBUtUKAzhHN1tw0",
  authDomain: "bl-saas.firebaseapp.com",
  projectId: "bl-saas",
  storageBucket: "bl-saas.firebasestorage.app",
  messagingSenderId: "211308654704",
  appId: "1:211308654704:web:732d22ec539f94f25f84b5",
  measurementId: "G-50N5YRBRZ5"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication
export const auth = getAuth(app);

// Initialize Cloud Firestore
export const db = getFirestore(app);

// Initialize Cloud Storage
export const storage = getStorage(app);

export default app;
