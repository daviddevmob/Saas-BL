'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Button from '@/components/Button';
import { auth, db, storage } from '@/lib/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { validateImage } from '@/lib/imageValidation';

export default function CompleteProfilePage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState('');
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [photoURL, setPhotoURL] = useState('/dashboard/avatar.png');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setIsChecking(true);
      if (!user) {
        router.push('/login');
        return;
      }

      // Verificar se já tem perfil COMPLETO (com bio e name)
      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          // Se perfil está completo (tem bio e name), ir para dashboard
          if (userData.bio && userData.name) {
            router.push('/dashboard');
            return;
          }
          // Senão, carregar dados do usuário para editar
          setUserEmail(userData.email || user.email || '');
          setName(userData.name || '');
          if (userData.photoURL) {
            setPhotoURL(userData.photoURL);
          }
          setIsChecking(false);
          return;
        }
      } catch (err) {
        console.error('Error checking profile:', err);
      }

      setUserEmail(user.email || '');
      setIsChecking(false);
    });

    return () => unsubscribe();
  }, [router]);

  const handlePhotoChange = async (file: File) => {
    if (!auth.currentUser) return;

    setError('');

    try {
      // Validate image
      const validationError = await validateImage(file);
      if (validationError) {
        setError(validationError.message);
        return;
      }

      // Upload file to Firebase Storage
      const storageRef = ref(storage, `profiles/${auth.currentUser.uid}/avatar`);
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);
      setPhotoURL(downloadURL);
    } catch (err) {
      console.error('Error uploading photo:', err);
      setError('Erro ao fazer upload da foto. Tente novamente.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    if (!name.trim()) {
      setError('Por favor, insira seu nome');
      setIsLoading(false);
      return;
    }

    if (!auth.currentUser) {
      setError('Erro de autenticação');
      setIsLoading(false);
      return;
    }

    try {
      // Create user profile in Firestore
      await setDoc(doc(db, 'users', auth.currentUser.uid), {
        uid: auth.currentUser.uid,
        email: userEmail,
        name: name,
        bio: bio,
        photoURL: photoURL,
        admin: false,
        createdAt: new Date().toISOString(),
      });

      // Redirect to dashboard
      router.push('/dashboard');
    } catch (err: any) {
      setError('Erro ao salvar perfil. Tente novamente.');
      setIsLoading(false);
    }
  };

  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Image
            src="/bl-logo.svg"
            alt="BrandingLab Logo"
            width={60}
            height={60}
          />
        </div>

        {/* Title */}
        <h1 className="text-3xl font-bold text-slate-900 text-center mb-2">
          Complete seu Perfil
        </h1>
        <p className="text-center text-slate-600 mb-8">
          Preencha as informações para começar a usar o BrandingLab
        </p>

        {/* Error Message */}
        {error && (
          <div className="p-3 mb-6 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Photo Upload */}
          <div className="flex justify-center mb-6">
            <div className="relative w-fit">
              <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-slate-300">
                <Image
                  src={photoURL}
                  alt="Foto do Perfil"
                  width={96}
                  height={96}
                  className="w-full h-full object-cover"
                />
              </div>
              <button
                type="button"
                className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center transition border-2 border-white shadow-md"
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'image/*';
                  input.onchange = (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) {
                      handlePhotoChange(file);
                    }
                  };
                  input.click();
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </button>
            </div>
          </div>

          {/* Email (Read-only) */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Email
            </label>
            <input
              type="email"
              value={userEmail}
              disabled
              className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-slate-100 text-slate-600 cursor-not-allowed"
            />
          </div>

          {/* Name */}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-2">
              Nome *
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Seu nome completo"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            />
          </div>

          {/* Bio */}
          <div>
            <label htmlFor="bio" className="block text-sm font-medium text-slate-700 mb-2">
              Bio
            </label>
            <textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Uma breve descrição sobre você"
              rows={3}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition resize-none"
            />
          </div>

          {/* Submit Button */}
          <Button
            type="submit"
            variant="primary"
            size="md"
            fullWidth
            isLoading={isLoading}
          >
            Continuar
          </Button>
        </form>

        {/* Logout Option */}
        <button
          onClick={async () => {
            try {
              await signOut(auth);
              router.push('/login');
            } catch (err) {
              console.error('Error logging out:', err);
            }
          }}
          className="w-full mt-4 py-2 text-slate-600 hover:text-slate-900 transition text-sm"
        >
          ou fazer logout
        </button>
      </div>
    </div>
  );
}
