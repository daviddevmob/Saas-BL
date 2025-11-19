import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

// Set persistence to local
setPersistence(auth, browserLocalPersistence);

export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  bio: string;
  photoURL: string;
  createdAt: string;
}

/**
 * Register a new user with email and password
 */
export const registerUser = async (email: string, password: string, name: string) => {
  try {
    // Create user in Firebase Auth
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Create user profile in Firestore
    const userProfile: UserProfile = {
      uid: user.uid,
      email: email,
      name: name,
      bio: "",
      photoURL: "/dashboard/avatar.png",
      createdAt: new Date().toISOString(),
    };

    await setDoc(doc(db, "users", user.uid), userProfile);

    return {
      success: true,
      user: userProfile,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Sign in user with email and password
 */
export const loginUser = async (email: string, password: string) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Get user profile from Firestore
    const userDoc = await getDoc(doc(db, "users", user.uid));
    const userProfile = userDoc.data() as UserProfile;

    return {
      success: true,
      user: userProfile,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Sign out current user
 */
export const logoutUser = async () => {
  try {
    await signOut(auth);
    return {
      success: true,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Get user profile from Firestore
 */
export const getUserProfile = async (uid: string) => {
  try {
    const userDoc = await getDoc(doc(db, "users", uid));
    if (userDoc.exists()) {
      return {
        success: true,
        user: userDoc.data() as UserProfile,
      };
    } else {
      return {
        success: false,
        error: "User profile not found",
      };
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Update user profile in Firestore
 */
export const updateUserProfile = async (uid: string, updates: Partial<UserProfile>) => {
  try {
    await setDoc(doc(db, "users", uid), updates, { merge: true });

    return {
      success: true,
      message: "Profile updated successfully",
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
};
