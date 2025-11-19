'use client';

import { FormEvent, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import Button from '@/components/Button';
import { auth, db } from '@/lib/firebase';
import { signInWithEmailAndPassword, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [loginImage, setLoginImage] = useState('/login/image_login.jpg');
  const [loginOpacity, setLoginOpacity] = useState(1);
  const [loginThemeType, setLoginThemeType] = useState<'full' | 'card'>('full');
  const router = useRouter();

  // Carregar configurações de login (cache primeiro, depois Firebase)
  useEffect(() => {
    // Carregar do cache primeiro (rápido)
    const cachedConfig = localStorage.getItem('loginConfig');
    if (cachedConfig) {
      try {
        const config = JSON.parse(cachedConfig);
        if (config.image) setLoginImage(config.image);
        if (config.opacity) setLoginOpacity(config.opacity);
        if (config.themeType) setLoginThemeType(config.themeType);
      } catch (err) {
        console.error('Error loading cached login config:', err);
      }
    }

    // Sincronizar com Firebase em background
    const syncLoginConfig = async () => {
      try {
        const configDoc = await getDoc(doc(db, 'configs', 'login'));
        if (configDoc.exists()) {
          const configData = configDoc.data();

          // Carregar imagem
          if (configData.image) {
            setLoginImage(configData.image);
          }

          // Carregar opacidade (converter string 0-1 para número)
          let opacityValue = 1;
          try {
            opacityValue = parseFloat(configData.opacity_image || '1');
            setLoginOpacity(opacityValue);
          } catch {
            setLoginOpacity(1);
          }

          // Carregar tipo de tema (0 = full, 1 = card)
          const themeType = configData.card_type === 1 ? 'card' : 'full';
          setLoginThemeType(themeType);

          // Salvar em cache (localStorage)
          localStorage.setItem(
            'loginConfig',
            JSON.stringify({
              image: configData.image || '/login/image_login.jpg',
              opacity: opacityValue,
              themeType: themeType,
            })
          );
        }
      } catch (err) {
        console.error('Error syncing login config from Firebase:', err);
      }
    };

    syncLoginConfig();
  }, []);

  // Redirecionar se já está logado
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Usuário logado, redirecionar para home (que vai validar perfil)
        router.push('/');
      }
    });

    return () => unsubscribe();
  }, [router]);

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validatePassword = (password: string): boolean => {
    return password.length >= 6;
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    // Validação
    if (!email) {
      setError('Por favor, insira seu email');
      setIsLoading(false);
      return;
    }

    if (!validateEmail(email)) {
      setError('Email inválido');
      setIsLoading(false);
      return;
    }

    if (!password) {
      setError('Por favor, insira sua senha');
      setIsLoading(false);
      return;
    }

    if (!validatePassword(password)) {
      setError('Senha deve ter no mínimo 6 caracteres');
      setIsLoading(false);
      return;
    }

    try {
      // Sign in with Firebase
      await signInWithEmailAndPassword(auth, email, password);
      // Redirect will happen automatically via onAuthStateChanged
    } catch (err: any) {
      let errorMessage = 'Erro ao fazer login';

      if (err.code === 'auth/user-not-found') {
        errorMessage = 'Usuário não encontrado';
      } else if (err.code === 'auth/wrong-password') {
        errorMessage = 'Senha incorreta';
      } else if (err.code === 'auth/invalid-email') {
        errorMessage = 'Email inválido';
      } else if (err.code === 'auth/user-disabled') {
        errorMessage = 'Usuário desativado';
      }

      setError(errorMessage);
      setIsLoading(false);
    }
  };

  // Conteúdo do formulário
  const FormContent = () => (
    <div className="w-full max-w-md">
      {/* Logo/Header */}
      <div className="mb-8 text-center">
        <div className="flex justify-center mb-6">
          <Image
            src="/bl-logo.svg"
            alt="BrandingLab Logo"
            width={60}
            height={60}
          />
        </div>
        <h1 className="text-4xl font-bold text-slate-900 font-display mb-2">
          Bem-vindo(a) de Volta
        </h1>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Error Message */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Email Field */}
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-slate-700 mb-2"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seu@email.com"
            required
            className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
          />
        </div>

        {/* Password Field */}
        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-slate-700 mb-2"
          >
            Senha
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
          />
        </div>

        {/* Submit Button */}
        <div className="flex justify-center">
          <Button
            type="submit"
            size="sm"
            width={137}
            height={32}
            isLoading={isLoading}
          >
            Entrar com Senha
          </Button>
        </div>
      </form>

      {/* Divider */}
      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-300"></div>
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-2 bg-slate-50 text-slate-500">ou</span>
        </div>
      </div>

      {/* Magic Link Button */}
      <Button
        type="button"
        fullWidth
        size="sm"
        height={32}
      >
        Entrar com Link Mágico 🚀
      </Button>
    </div>
  );

  // Simplified Layout - Form on top, small image at bottom
  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Formulário - Top */}
      <div className="flex-1 flex items-center justify-center px-8 py-12 bg-slate-50">
        <FormContent />
      </div>

      {/* Imagem - Bottom (Small) */}
      <div className="h-32 bg-white relative overflow-hidden w-full">
        <Image
          src={loginImage}
          alt="BrandingLab"
          fill
          className="object-cover"
          priority
          style={{
            opacity: loginOpacity,
            transition: 'opacity 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}
