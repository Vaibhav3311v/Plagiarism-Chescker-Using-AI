// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { 
  getAuth, 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  updateProfile,
  updatePassword,
  GoogleAuthProvider,
  signInWithPopup,
  deleteUser,
  getAdditionalUserInfo,
  sendEmailVerification,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  EmailAuthProvider,
  reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { 
  getFirestore, 
  collection, 
  addDoc, 
  setDoc,
  doc,
  deleteDoc,
  query, 
  where, 
  orderBy, 
  getDocs,
  limit
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

// Firebase configuration - loaded from environment variables via server
const firebaseConfig = {
  apiKey: window.FIREBASE_API_KEY || "",
  authDomain: window.FIREBASE_AUTH_DOMAIN || "",
  projectId: window.FIREBASE_PROJECT_ID || "",
  storageBucket: window.FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: window.FIREBASE_MESSAGING_SENDER_ID || "",
  appId: window.FIREBASE_APP_ID || "",
  measurementId: window.FIREBASE_MEASUREMENT_ID || ""
};

// Initialize Firebase
let app, auth, db;
try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  console.log("Firebase initialized.");
} catch (error) {
  console.error("Firebase initialization failed:", error);
}

// Ensure the page acts appropriately for its route (Route Guarding)
function setupRouteGuards() {
  const isAuthPage = window.location.pathname.endsWith('auth.html');
  
  onAuthStateChanged(auth, (user) => {
    // A user is "authenticated" if they are logged in (email verification is now optional)
    const isVerified = user;
    
    if (user && isVerified) {
      console.log("Logged in user:", user.email);
      // Auto-redirect off Auth page if logged in
      if (isAuthPage && !window.suppressAuthRedirect) {
        window.location.href = 'index.html';
      } else if (!isAuthPage) {
        // We are on index.html, user is logged in
        document.body.classList.add('user-logged-in');
        const userDisplay = document.getElementById('user-profile-name');
        if (userDisplay) {
          const fallbackName = user.email ? user.email.split('@')[0] : (user.phoneNumber || 'User');
          userDisplay.textContent = user.displayName || fallbackName;
        }
      }
    } else {
      console.log("No user logged in or email not verified.");
      // Protect index.html
      if (!isAuthPage) {
        window.location.href = 'auth.html';
      }
    }
  });
}

// Initialize Guards automatically
window.addEventListener('load', () => setupRouteGuards());

// Export Firebase features globally for use in app.js / auth.js
window.fbAuth = auth;
window.fbDb = db;
window.fbMethods = {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  updatePassword,
  GoogleAuthProvider,
  signInWithPopup,
  deleteUser,
  getAdditionalUserInfo,
  sendEmailVerification,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  EmailAuthProvider,
  reauthenticateWithCredential,
  collection,
  addDoc,
  setDoc,
  doc,
  deleteDoc,
  query,
  where,
  orderBy,
  getDocs,
  limit
};
