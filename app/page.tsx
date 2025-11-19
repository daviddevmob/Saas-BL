'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        // Usuário não autenticado
        router.push('/login');
        return;
      }

      // Usuário autenticado, verificar se tem perfil
      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));

        if (!userDoc.exists()) {
          // Não tem perfil, ir para tela de completar perfil
          router.push('/complete-profile');
        } else {
          // Tem perfil, salvar em cache e ir para dashboard
          const userData = userDoc.data();
          localStorage.setItem(
            'userCache',
            JSON.stringify({
              uid: user.uid,
              email: userData?.email || user.email || '',
              name: userData?.name || '',
              bio: userData?.bio || '',
              photoURL: userData?.photoURL || '/dashboard/avatar.png',
              admin: userData?.admin || false,
              createdAt: userData?.createdAt || new Date().toISOString(),
            })
          );
          router.push('/dashboard');
        }
      } catch (err) {
        console.error('Error checking user profile:', err);
        router.push('/login');
      }
    });

    return () => unsubscribe();
  }, [router]);

  return null;
}
