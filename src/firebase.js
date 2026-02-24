import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAoCy8CgjNSnpI3bVbcLJBU6pX61ILUB2g",
  authDomain: "penjualansk.firebaseapp.com",
  projectId: "penjualansk",
  storageBucket: "penjualansk.firebasestorage.app",
  messagingSenderId: "422208396983",
  appId: "1:422208396983:web:0da873fb88eb2c16e43732",
  measurementId: "G-XZ1GLP2S60"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
