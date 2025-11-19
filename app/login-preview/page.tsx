'use client';

import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { useState } from 'react';
import { Suspense } from 'react';

function LoginPreviewContent() {
  const searchParams = useSearchParams();

  const theme = (searchParams.get('theme') || 'full') as 'full' | 'card';
  const opacityString = searchParams.get('opacity') || '1';

  // Convert string opacity (0-1) to percentage (0-100)
  let opacity = 100;
  try {
    opacity = Math.round(parseFloat(opacityString) * 100);
  } catch {
    opacity = 100;
  }

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (theme === 'full') {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{
          backgroundImage: `
            linear-gradient(135deg, #2CF5FB 0%, #B5BAF8 100%)
          `,
          opacity: opacity / 100,
        }}
      >
        <div className="w-full max-w-md px-4">
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
          <h1
            style={{
              fontFamily: 'var(--font-public-sans)',
              fontWeight: 700,
              fontSize: '2rem',
              lineHeight: '2.5rem',
              letterSpacing: '0%',
              color: '#FFFFFF',
              textAlign: 'center',
              marginBottom: '0.5rem',
            }}
          >
            Bem-vindo
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-inter)',
              fontWeight: 400,
              fontSize: '0.875rem',
              lineHeight: '1.25rem',
              letterSpacing: '0%',
              color: 'rgba(255, 255, 255, 0.8)',
              textAlign: 'center',
              marginBottom: '2rem',
            }}
          >
            Faça login para acessar sua conta
          </p>

          {/* Form */}
          <form className="space-y-4">
            {/* Email Input */}
            <input
              type="email"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                borderRadius: '0.5rem',
                border: 'none',
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                color: '#1C2024',
                outline: 'none',
              }}
            />

            {/* Password Input */}
            <input
              type="password"
              placeholder="Sua senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                borderRadius: '0.5rem',
                border: 'none',
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                color: '#1C2024',
                outline: 'none',
              }}
            />

            {/* Login Button */}
            <button
              type="button"
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                borderRadius: '0.5rem',
                border: 'none',
                backgroundColor: '#06B6D4',
                fontFamily: 'var(--font-public-sans)',
                fontWeight: 600,
                fontSize: '0.875rem',
                color: '#FFFFFF',
                cursor: 'pointer',
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#0891b2')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#06B6D4')}
            >
              Entrar
            </button>
          </form>

          {/* Footer Text */}
          <p
            style={{
              fontFamily: 'var(--font-inter)',
              fontWeight: 400,
              fontSize: '0.75rem',
              lineHeight: '1rem',
              letterSpacing: '0%',
              color: 'rgba(255, 255, 255, 0.7)',
              textAlign: 'center',
              marginTop: '2rem',
            }}
          >
            BrandingLab © 2024
          </p>
        </div>
      </div>
    );
  }

  // Card Layout
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{
        backgroundColor: '#F8FAFC',
        opacity: opacity / 100,
      }}
    >
      <div className="w-full max-w-md px-4">
        <div
          className="rounded-2xl shadow-lg p-8"
          style={{
            backgroundColor: '#FFFFFF',
          }}
        >
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
          <h1
            style={{
              fontFamily: 'var(--font-public-sans)',
              fontWeight: 700,
              fontSize: '1.875rem',
              lineHeight: '2.25rem',
              letterSpacing: '0%',
              color: '#1C2024',
              textAlign: 'center',
              marginBottom: '0.5rem',
            }}
          >
            Bem-vindo
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-inter)',
              fontWeight: 400,
              fontSize: '0.875rem',
              lineHeight: '1.25rem',
              letterSpacing: '0%',
              color: '#60646C',
              textAlign: 'center',
              marginBottom: '2rem',
            }}
          >
            Faça login para acessar sua conta
          </p>

          {/* Form */}
          <form className="space-y-4">
            {/* Email Input */}
            <input
              type="email"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                borderRadius: '0.5rem',
                border: '1px solid #E2E8F0',
                backgroundColor: '#FFFFFF',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                color: '#1C2024',
                outline: 'none',
              }}
            />

            {/* Password Input */}
            <input
              type="password"
              placeholder="Sua senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                borderRadius: '0.5rem',
                border: '1px solid #E2E8F0',
                backgroundColor: '#FFFFFF',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                color: '#1C2024',
                outline: 'none',
              }}
            />

            {/* Login Button */}
            <button
              type="button"
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                borderRadius: '0.5rem',
                border: 'none',
                backgroundColor: '#06B6D4',
                fontFamily: 'var(--font-public-sans)',
                fontWeight: 600,
                fontSize: '0.875rem',
                color: '#FFFFFF',
                cursor: 'pointer',
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#0891b2')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#06B6D4')}
            >
              Entrar
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function LoginPreviewPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginPreviewContent />
    </Suspense>
  );
}
