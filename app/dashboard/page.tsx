'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { auth, db, storage } from '@/lib/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { validateImage } from '@/lib/imageValidation';
import Link from 'next/link';
import Image from 'next/image';
import Button from '@/components/Button';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import CsvUpload from '@/components/CsvUpload';

interface MenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  expanded?: boolean;
  children?: MenuItem[];
}

// Calculate SVG path for the filled semicircle based on percentage
function getFilledPath(percentage: number) {
  const radius = 30;
  const centerX = 50;
  const centerY = 50;
  const startX = 20;
  const startY = 50;

  // Convert percentage to angle (0% = 180°, 100% = 0°)
  const angleDegrees = (percentage / 100) * 180;
  const angleRad = (180 - angleDegrees) * (Math.PI / 180);

  const endX = centerX + radius * Math.cos(angleRad);
  const endY = centerY - radius * Math.sin(angleRad);

  const largeArc = angleDegrees > 90 ? 1 : 0;
  return `M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY}`;
}

// Animated Gauge Card Component
function GaugeCard({ title, finalValue }: { title: string; finalValue: number }) {
  const [animatedValue, setAnimatedValue] = useState(0);

  useEffect(() => {
    let animationFrame: ReturnType<typeof setInterval>;
    let currentValue = 0;
    const increment = finalValue / 40; // Animate over ~40 frames for smoother animation

    animationFrame = setInterval(() => {
      currentValue += increment;
      if (currentValue >= finalValue) {
        setAnimatedValue(finalValue);
        clearInterval(animationFrame);
      } else {
        setAnimatedValue(Math.floor(currentValue));
      }
    }, 16); // ~60fps

    return () => clearInterval(animationFrame);
  }, [finalValue]);

  // Calculate the stroke dash offset for smooth fill animation
  // Semicircle arc length ≈ π * radius = π * 30 ≈ 94.25
  const arcLength = Math.PI * 30;
  const strokeDashoffset = arcLength * (1 - animatedValue / 100);

  return (
    <div
      key={title}
      className="rounded-3xl border border-slate-200 flex flex-col items-center justify-center px-[20px] py-[20px] w-full md:w-[325px]"
      style={{
        backgroundColor: '#FFFFFF',
        borderColor: '#E2E8F0',
        height: '182px',
        minHeight: '180px',
        gap: '0',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <p
        style={{
          fontFamily: 'var(--font-public-sans)',
          fontWeight: 600,
          fontSize: '1rem',
          lineHeight: '1.5rem',
          letterSpacing: '0%',
          color: '#314158',
          margin: 0,
          textAlign: 'center',
        }}
      >
        {title}
      </p>
      {/* Semicircle Progress Chart */}
      <svg width="100%" height="100%" viewBox="0 0 100 60" preserveAspectRatio="xMidYMid meet" style={{ flex: 1, minHeight: 0 }}>
        {/* Background semicircle (unfilled - 10% opacity) */}
        <path
          d="M 20 50 A 30 30 0 0 1 80 50"
          fill="none"
          stroke="rgba(34, 211, 238, 0.1)"
          strokeWidth="8"
          strokeLinecap="round"
        />
        {/* Filled semicircle with smooth animation using stroke-dasharray */}
        <path
          d="M 20 50 A 30 30 0 0 1 80 50"
          fill="none"
          stroke="#22D3EE"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={arcLength}
          strokeDashoffset={strokeDashoffset}
          style={{
            transition: 'stroke-dashoffset 0.05s linear',
          }}
        />
      </svg>
      {/* Percentage and Complete Overlay */}
      <div
        style={{
          position: 'absolute',
          bottom: '25px',
          left: '0',
          right: '0',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '-2px',
        }}
      >
        <p
          style={{
            fontFamily: 'var(--font-inter)',
            fontWeight: 700,
            fontSize: '24px',
            lineHeight: '100%',
            letterSpacing: '0%',
            color: '#1C2024',
            margin: 0,
          }}
        >
          {animatedValue}%
        </p>
        <p
          style={{
            fontFamily: 'var(--font-inter)',
            fontWeight: 400,
            fontSize: '12px',
            lineHeight: '12px',
            letterSpacing: '0%',
            color: '#60646C',
            margin: 0,
          }}
        >
          Completo
        </p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [userEmail, setUserEmail] = useState('');
  const [expandedMenus, setExpandedMenus] = useState<Set<string>>(new Set());
  const [activeMenu, setActiveMenu] = useState<string>('inicio');
  const [progressWidth, setProgressWidth] = useState(0);
  const [userName, setUserName] = useState('');
  const [userBio, setUserBio] = useState('');
  const [userPhoto, setUserPhoto] = useState('/dashboard/avatar.png');
  const [isUserAdmin, setIsUserAdmin] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [loginOpacity, setLoginOpacity] = useState(100);
  const [loginThemeType, setLoginThemeType] = useState<'full' | 'card'>('full');
  const [loginImage, setLoginImage] = useState('/login/image_login.jpg');
  const [isUploadingLoginImage, setIsUploadingLoginImage] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // Load from cache first
    const cachedUserData = localStorage.getItem('userCache');
    if (cachedUserData) {
      try {
        const userData = JSON.parse(cachedUserData);
        setUserName(userData.name || '');
        setUserBio(userData.bio || '');
        setUserPhoto(userData.photoURL || '/dashboard/avatar.png');
        setIsUserAdmin(userData.admin || false);
        setUserEmail(userData.email || '');
      } catch (err) {
        console.error('Error loading from cache:', err);
      }
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        localStorage.removeItem('userCache');
        router.push('/login');
        return;
      }

      setUserEmail(user.email || '');

      // Load user profile from Firestore
      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();

          // Validate if profile is complete (must have bio and name)
          if (!userData.bio || !userData.name) {
            router.push('/complete-profile');
            return;
          }

          setUserName(userData.name || '');
          setUserBio(userData.bio || '');
          setIsUserAdmin(userData.admin || false);
          if (userData.photoURL) {
            setUserPhoto(userData.photoURL);
          }

          // Save to cache
          localStorage.setItem(
            'userCache',
            JSON.stringify({
              name: userData.name || '',
              bio: userData.bio || '',
              photoURL: userData.photoURL || '/dashboard/avatar.png',
              admin: userData.admin || false,
              email: user.email || '',
            })
          );
        }

        // Load login config from Firestore
        try {
          const configDoc = await getDoc(doc(db, 'configs', 'login'));
          if (configDoc.exists()) {
            const configData = configDoc.data();

            // Parse card_type (0 = full, 1 = card)
            const cardType = configData.card_type === 1 ? 'card' : 'full';
            setLoginThemeType(cardType);

            // Parse opacity_image (string from 0-1, convert to 0-100)
            try {
              const opacityValue = parseFloat(configData.opacity_image || '1');
              const opacityPercent = Math.round(opacityValue * 100);
              setLoginOpacity(opacityPercent);
            } catch {
              setLoginOpacity(100);
            }
          }
        } catch (err) {
          console.error('Error loading login config:', err);
        }
      } catch (err) {
        console.error('Error loading user profile:', err);
      } finally {
        setIsLoadingProfile(false);
      }
    });

    return () => unsubscribe();
  }, [router]);

  // Save login config to Firestore when opacity changes
  useEffect(() => {
    if (!isUserAdmin) return;

    const saveConfig = async () => {
      try {
        // Convert opacity from 0-100 to 0-1 string
        const opacityString = (loginOpacity / 100).toFixed(2);

        await setDoc(
          doc(db, 'configs', 'login'),
          {
            opacity_image: opacityString,
            card_type: loginThemeType === 'card' ? 1 : 0,
          },
          { merge: true }
        );
      } catch (err) {
        console.error('Error saving login config:', err);
      }
    };

    const debounceTimer = setTimeout(saveConfig, 500);
    return () => clearTimeout(debounceTimer);
  }, [loginOpacity, isUserAdmin]);

  // Save login theme type to Firestore
  useEffect(() => {
    if (!isUserAdmin) return;

    const saveThemeType = async () => {
      try {
        await setDoc(
          doc(db, 'configs', 'login'),
          {
            card_type: loginThemeType === 'card' ? 1 : 0,
          },
          { merge: true }
        );
      } catch (err) {
        console.error('Error saving login theme type:', err);
      }
    };

    saveThemeType();
  }, [loginThemeType, isUserAdmin]);

  // Animate progress bar on page load
  useEffect(() => {
    let animationFrame: ReturnType<typeof setInterval>;
    let currentValue = 0;
    const finalValue = 45;
    const increment = finalValue / 40; // Animate over ~40 frames

    animationFrame = setInterval(() => {
      currentValue += increment;
      if (currentValue >= finalValue) {
        setProgressWidth(finalValue);
        clearInterval(animationFrame);
      } else {
        setProgressWidth(Math.floor(currentValue));
      }
    }, 16); // ~60fps

    return () => clearInterval(animationFrame);
  }, []);


  const handleLogout = async () => {
    try {
      await signOut(auth);
      // Firebase will automatically redirect via onAuthStateChanged
    } catch (err) {
      console.error('Error logging out:', err);
    }
  };

  // Handle ESC key and block scroll when drawer is open
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isDrawerOpen) {
        setIsDrawerOpen(false);
      }
    };

    // Block scroll on body when drawer is open
    if (isDrawerOpen) {
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
    } else {
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
    }

    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
    };
  }, [isDrawerOpen]);

  const toggleMenu = (menuId: string) => {
    const newExpandedMenus = new Set(expandedMenus);
    if (newExpandedMenus.has(menuId)) {
      newExpandedMenus.delete(menuId);
    } else {
      newExpandedMenus.add(menuId);
    }
    setExpandedMenus(newExpandedMenus);
  };

  // Generate last 6 completed months data for growth trend (excluding current month)
  const generateGrowthData = () => {
    const data = [];
    const now = new Date();
    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    for (let i = 5; i >= 1; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthName = months[date.getMonth()];
      data.push({
        name: monthName,
        value: Math.floor(Math.random() * 60) + 40, // Random values between 40-100
      });
    }
    return data;
  };

  const baseMenuItems: MenuItem[] = [
    {
      id: 'inicio',
      label: 'Início',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      ),
    },
    {
      id: 'integracoes',
      label: 'Integrações',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      ),
    },
  ];

  const menuItems: MenuItem[] = isUserAdmin
    ? [
        ...baseMenuItems,
        {
          id: 'administracao',
          label: 'Administração',
          icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
            </svg>
          ),
          children: [],
        },
      ]
    : baseMenuItems;

  return (
    <div className={`min-h-screen flex flex-col md:flex-row bg-white ${isDrawerOpen ? 'overflow-hidden' : ''}`}>
      {/* Mobile Header with Hamburger */}
      <div className="md:hidden flex items-center justify-between px-4 py-4 bg-white border-b border-slate-200">
        <button
          onClick={() => setIsDrawerOpen(!isDrawerOpen)}
          className="p-2 hover:bg-slate-100 rounded-lg transition"
          aria-label="Toggle menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <h1 className="text-lg font-semibold text-slate-900">
          {menuItems.find((m) => m.id === activeMenu)?.label}
        </h1>
        <div className="w-10" />
      </div>

      {/* Mobile Overlay */}
      {isDrawerOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 opacity-100"
          onClick={() => setIsDrawerOpen(false)}
          role="presentation"
        />
      )}

      {/* Sidebar / Drawer */}
      <aside
        className={`fixed md:relative flex flex-col overflow-hidden w-[350px] md:overflow-hidden z-50 md:z-auto transition-transform duration-300 ease-out ${
          isDrawerOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
        role="navigation"
        aria-label="Main navigation drawer"
        style={{
          backgroundImage: `
            linear-gradient(180deg, transparent 0%, #F8FAFC 20%, #F1F5F9 100%),
            linear-gradient(to right, #2CF5FB 0%, #B5BAF8 100%)
          `,
          ...(isDrawerOpen && {
            top: 0,
            left: 0,
            bottom: 0,
            position: 'fixed',
            height: '100vh',
            overflowY: 'auto'
          }),
        }}
      >
        {/* Close Button - Mobile Only */}
        <div className="md:hidden flex-shrink-0 p-4 flex justify-end border-b border-white/20">
          <button
            onClick={() => setIsDrawerOpen(false)}
            className="p-2 hover:bg-white/20 rounded-lg transition"
            aria-label="Close menu"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Avatar Section - Fixed Header */}
        {isLoadingProfile ? (
          <div className="flex-shrink-0 pt-8 px-6 pb-4 flex flex-col items-center border-b border-white/20">
            {/* Avatar Skeleton */}
            <div
              className="w-[100px] h-[100px] rounded-full mb-4 border-2 border-white/30 animate-pulse"
              style={{ backgroundColor: 'rgba(255, 255, 255, 0.2)' }}
            />
            {/* Name Skeleton */}
            <div className="w-32 h-6 rounded-lg mb-3 animate-pulse" style={{ backgroundColor: 'rgba(255, 255, 255, 0.2)' }} />
            {/* Bio Skeleton */}
            <div className="w-24 h-4 rounded-lg mb-3 animate-pulse" style={{ backgroundColor: 'rgba(255, 255, 255, 0.2)' }} />
            {/* Progress Skeleton */}
            <div className="mt-3 w-[101px] mx-auto">
              <div
                className="h-1 rounded-full overflow-hidden animate-pulse"
                style={{ backgroundColor: 'rgba(255, 255, 255, 0.2)' }}
              />
            </div>
          </div>
        ) : (
          <div className="flex-shrink-0 pt-8 px-6 pb-4 flex flex-col items-center border-b border-white/20">
            <div className="w-[100px] h-[100px] rounded-full overflow-hidden mb-4 border-2 border-white/30">
              <Image
                src={userPhoto}
                alt="Avatar"
                width={100}
                height={100}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="text-center">
              <p
                className="mb-1 text-center"
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontWeight: 400,
                  fontSize: '12px',
                  lineHeight: '100%',
                  letterSpacing: '0%',
                  color: '#60646C',
                }}
              >
                Bem-vinda de volta
              </p>
              <h2
                className="mb-1"
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontWeight: 700,
                  fontSize: '24px',
                  lineHeight: '100%',
                  letterSpacing: '0%',
                  textAlign: 'center',
                  background: 'radial-gradient(93.24% 475.86% at 50% 50%, #475868 0%, #1C2024 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                {userName || 'Usuário'}
              </h2>
              <p
                style={{
                  fontFamily: 'var(--font-public-sans)',
                  fontWeight: 400,
                  fontSize: '9pt',
                  lineHeight: '1.25rem',
                  letterSpacing: '0%',
                  textAlign: 'center',
                  color: '#60646C',
                }}
              >
                {userBio || 'BrandingLab'}
              </p>

              {/* Progress Indicator */}
              <div className="mt-3 w-[101px] mx-auto">
                <div
                  className="h-1 rounded-full overflow-hidden"
                  style={{
                    backgroundColor: '#E2E8F0',
                  }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${progressWidth}%`,
                      backgroundColor: '#00C16A',
                      transition: 'width 0.05s linear',
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Sidebar Content - Scrollable Menu */}
        <div className="flex-1 px-6 pt-6 pb-4 flex flex-col gap-4 overflow-y-auto">
          {menuItems.map((item) => (
            <div key={item.id}>
              <button
                  onClick={() => {
                    setActiveMenu(item.id);
                    if (item.children) toggleMenu(item.id);
                    // Close drawer on mobile when menu item clicked
                    setIsDrawerOpen(false);
                  }}
                  className="w-full md:w-[295px] h-[50px] flex items-center justify-between px-5 py-3.75 rounded-xl transition text-slate-700 relative"
                  style={{
                    backgroundColor: activeMenu === item.id ? '#00D3F22E' : 'transparent',
                    fontFamily: 'var(--font-public-sans)',
                    fontWeight: 500,
                    fontSize: '14px',
                    lineHeight: '1.25rem',
                    letterSpacing: '0%',
                    color: '#314158',
                  }}
                  onMouseEnter={(e) => {
                    if (activeMenu !== item.id) {
                      e.currentTarget.style.backgroundColor = '#FFFFFF';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (activeMenu !== item.id) {
                      e.currentTarget.style.backgroundColor = '';
                    }
                  }}
                >
                  {activeMenu === item.id && (
                    <div
                      style={{
                        position: 'absolute',
                        left: '0',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: '4px',
                        height: '30px',
                        backgroundColor: '#06B6D4',
                        borderRadius: '0 2px 2px 0',
                      }}
                    />
                  )}
                  <div className="flex items-center gap-1.5">
                    {item.icon}
                    <span>{item.label}</span>
                  </div>
                  {item.children && item.children.length >= 0 && (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className={`transition-transform ${
                        expandedMenus.has(item.id) ? 'rotate-90' : ''
                      }`}
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  )}
                </button>
            </div>
          ))}
        </div>

        {/* Footer with Logo and Text */}
        <div className="flex-shrink-0 px-4 pt-4 pb-6 border-t border-white/20 flex justify-center">
          <div className="flex items-end gap-2">
            <Image
              src="/bl-logo.svg"
              alt="BrandingLab Logo"
              width={28}
              height={28}
            />
            <Image
              src="/bl-text.svg"
              alt="BrandingLab Text"
              width={110}
              height={28}
              className="mb-0.5"
            />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main
        className={`flex-1 flex flex-col overflow-hidden ${isDrawerOpen ? 'pointer-events-none' : ''}`}
        style={{ backgroundColor: '#F8FAFC' }}
      >
        {/* Header with Tab Title (Desktop only) */}
        <div className="hidden md:block px-4 md:px-[110px] py-3" style={{ paddingTop: '12px', paddingBottom: '12px' }}>
          <h1
            style={{
              fontFamily: 'var(--font-public-sans)',
              fontWeight: 700,
              fontSize: '1.875rem',
              lineHeight: '2.25rem',
              letterSpacing: '0%',
              color: '#314158',
              margin: 0,
            }}
          >
            {menuItems.find((m) => m.id === activeMenu)?.label}
          </h1>
        </div>

        {/* Content */}
        {activeMenu === 'inicio' && (
          <div className="flex-1 flex flex-col gap-3 overflow-auto md:overflow-hidden px-4 md:px-[110px]" style={{ paddingTop: '5px', paddingBottom: '5px' }}>
            {/* Linha 1: 3 Cards - altura 206px, proporcão 206/(206+192+507) */}
            <div className="flex flex-col md:flex-row gap-3 md:min-h-0" style={{ flex: 'auto' }}>
              {/* First Card - Criar novo */}
              <div
                className="rounded-3xl border border-slate-200 flex-1 min-w-0 flex items-center gap-3.5 p-6"
                style={{
                  backgroundColor: '#FFFFFF',
                  borderColor: '#E2E8F0',
                  aspectRatio: '442 / 206',
                }}
              >
                {/* Circle */}
                <div
                  className="flex-shrink-0 rounded-full flex items-center justify-center"
                  style={{
                    width: '100px',
                    height: '100px',
                    backgroundColor: 'rgba(34, 211, 238, 0.1)',
                  }}
                >
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: '#22D3EE' }}>
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="12" y1="8" x2="12" y2="16" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                </div>
                {/* Column */}
                <div className="flex flex-col gap-1">
                  <p
                    style={{
                      fontFamily: 'var(--font-public-sans)',
                      fontWeight: 600,
                      fontSize: '1rem',
                      lineHeight: '1.5rem',
                      letterSpacing: '0%',
                      color: '#64748E',
                      margin: 0,
                    }}
                  >
                    Criar novo
                  </p>
                  <h3
                    style={{
                      fontFamily: 'var(--font-public-sans)',
                      fontWeight: 400,
                      fontSize: '2.25rem',
                      lineHeight: '2.5rem',
                      letterSpacing: '0%',
                      color: '#314158',
                      margin: 0,
                    }}
                  >
                    Objetivo
                  </h3>
                </div>
              </div>

              {/* Second Card - Criar nova Meta */}
              <div
                className="rounded-3xl border border-slate-200 flex-1 min-w-0 flex items-center gap-3.5 p-6"
                style={{
                  backgroundColor: '#FFFFFF',
                  borderColor: '#E2E8F0',
                  aspectRatio: '442 / 206',
                }}
              >
                {/* Circle */}
                <div
                  className="flex-shrink-0 rounded-full flex items-center justify-center"
                  style={{
                    width: '100px',
                    height: '100px',
                    backgroundColor: 'rgba(217, 70, 239, 0.18)',
                  }}
                >
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: '#D946EF' }}>
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="12" y1="8" x2="12" y2="16" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                </div>
                {/* Column */}
                <div className="flex flex-col gap-1">
                  <p
                    style={{
                      fontFamily: 'var(--font-public-sans)',
                      fontWeight: 600,
                      fontSize: '1rem',
                      lineHeight: '1.5rem',
                      letterSpacing: '0%',
                      color: '#64748E',
                      margin: 0,
                    }}
                  >
                    Criar nova
                  </p>
                  <h3
                    style={{
                      fontFamily: 'var(--font-public-sans)',
                      fontWeight: 400,
                      fontSize: '2.25rem',
                      lineHeight: '2.5rem',
                      letterSpacing: '0%',
                      color: '#314158',
                      margin: 0,
                    }}
                  >
                    Meta
                  </h3>
                </div>
              </div>

              {/* Third Card - Criar novo Plano de Ação */}
              <div
                className="rounded-3xl border border-slate-200 flex-1 min-w-0 flex items-center gap-3.5 p-6"
                style={{
                  backgroundColor: '#FFFFFF',
                  borderColor: '#E2E8F0',
                  aspectRatio: '442 / 206',
                }}
              >
                {/* Circle */}
                <div
                  className="flex-shrink-0 rounded-full flex items-center justify-center"
                  style={{
                    width: '100px',
                    height: '100px',
                    backgroundColor: 'rgba(45, 212, 191, 0.1)',
                  }}
                >
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: '#2DD4BF' }}>
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="12" y1="8" x2="12" y2="16" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                </div>
                {/* Column */}
                <div className="flex flex-col gap-1">
                  <p
                    style={{
                      fontFamily: 'var(--font-public-sans)',
                      fontWeight: 600,
                      fontSize: '1rem',
                      lineHeight: '1.5rem',
                      letterSpacing: '0%',
                      color: '#64748E',
                      margin: 0,
                    }}
                  >
                    Criar novo
                  </p>
                  <h3
                    style={{
                      fontFamily: 'var(--font-public-sans)',
                      fontWeight: 400,
                      fontSize: '2.25rem',
                      lineHeight: '2.5rem',
                      letterSpacing: '0%',
                      color: '#314158',
                      margin: 0,
                    }}
                  >
                    Plano de Ação
                  </h3>
                </div>
              </div>
            </div>

            {/* Linha 2: 4 Cards - altura 192px, proporcão 192/(206+192+507) */}
            <div className="flex flex-col md:flex-row gap-3 md:min-h-0" style={{ flex: 'auto' }}>
              <GaugeCard title="Informações da Marca" finalValue={37} />
              <GaugeCard title="Metas realizadas" finalValue={37} />
              <GaugeCard title="Metas realizadas" finalValue={37} />
              <GaugeCard title="Metas realizadas" finalValue={37} />
            </div>

            {/* Linha 3: 2 Cards - altura 437px, proporcão reduzida para deixar 70px margin bottom */}
            <div className="flex flex-col md:flex-row gap-3 md:min-h-0" style={{ flex: 'auto' }}>
              {/* First Card - Radar Chart */}
              <div
                key={1}
                className="rounded-3xl border border-slate-200 flex-1 min-w-0 flex flex-col p-6"
                style={{
                  backgroundColor: '#FFFFFF',
                  borderColor: '#E2E8F0',
                  aspectRatio: '668 / 507',
                  gap: '10px',
                }}
              >
                {/* Title */}
                <p
                  style={{
                    fontFamily: 'var(--font-public-sans)',
                    fontWeight: 600,
                    fontSize: '1rem',
                    lineHeight: '1.5rem',
                    letterSpacing: '0%',
                    color: '#314158',
                    margin: 0,
                    textAlign: 'center',
                  }}
                >
                  Diagnóstico e Análise da Marca - DAM
                </p>
                {/* Radar Chart */}
                <div style={{ width: '100%', flex: 1, minHeight: 0, pointerEvents: 'none' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart
                      data={[
                        { name: 'Experiência do cliente', value: 75 },
                        { name: 'Produto', value: 68 },
                        { name: 'Conteúdo', value: 62 },
                        { name: 'Mentalidade', value: 72 },
                        { name: 'Vendas', value: 65 },
                        { name: 'Gestão', value: 78 },
                      ]}
                    >
                      <PolarGrid stroke="#F1F1F1" strokeWidth={2} />
                      <PolarAngleAxis
                        dataKey="name"
                        tick={{
                          fontFamily: 'var(--font-inter)',
                          fontWeight: 500,
                          fontSize: 12,
                          fill: '#000000',
                        }}
                      />
                      <Radar name="Score" dataKey="value" stroke="#00CEE4" strokeWidth={4} fill="#53EAFD" fillOpacity={0.1} dot={{ fill: '#00CEE4', stroke: '#00CEE4', strokeWidth: 1.5, r: 3 }} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {/* Second Card - Area Chart */}
              <div
                key={2}
                className="rounded-3xl border border-slate-200 flex-1 min-w-0 flex flex-col p-6"
                style={{
                  backgroundColor: '#FFFFFF',
                  borderColor: '#E2E8F0',
                  aspectRatio: '668 / 507',
                  gap: '10px',
                }}
              >
                {/* Title */}
                <p
                  style={{
                    fontFamily: 'var(--font-public-sans)',
                    fontWeight: 600,
                    fontSize: '1rem',
                    lineHeight: '1.5rem',
                    letterSpacing: '0%',
                    color: '#314158',
                    margin: 0,
                    textAlign: 'center',
                  }}
                >
                  Tendência de Crescimento
                </p>
                {/* Area Chart with Custom Months */}
                <div style={{ width: '100%', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ width: '100%', flex: 1, minHeight: 0, pointerEvents: 'none' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={generateGrowthData()}>
                        <defs>
                          <linearGradient id="colorGrowth" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#00CEE4" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#00CEE4" stopOpacity={0.1} />
                          </linearGradient>
                        </defs>
                        <XAxis hide />
                        <YAxis hide />
                        <Area type="monotone" dataKey="value" stroke="#00CEE4" strokeWidth={2} fill="url(#colorGrowth)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Custom Months */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginTop: '8px' }}>
                    {generateGrowthData().map((item) => (
                      <div
                        key={item.name}
                        style={{
                          fontFamily: 'var(--font-inter)',
                          fontWeight: 400,
                          fontSize: 12,
                          color: '#60646C',
                          lineHeight: '12px',
                          flex: 1,
                          textAlign: 'center',
                        }}
                      >
                        {item.name}
                      </div>
                    ))}
                  </div>
                  {/* Info Row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginTop: '12px', paddingLeft: '5px', paddingRight: '5px' }}>
                    <span
                      style={{
                        fontFamily: 'var(--font-inter)',
                        fontWeight: 400,
                        fontSize: 12,
                        color: '#60646C',
                        lineHeight: '12px',
                      }}
                    >
                      Alta de 5,2% neste mês
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--font-inter)',
                        fontWeight: 400,
                        fontSize: 12,
                        color: '#60646C',
                        lineHeight: '12px',
                      }}
                    >
                      {(() => {
                        const data = generateGrowthData();
                        const now = new Date();
                        const firstMonth = data[0].name;
                        const lastMonth = data[data.length - 1].name;
                        const year = new Date(now.getFullYear(), now.getMonth() - 1, 1).getFullYear();
                        return `${firstMonth} - ${lastMonth} ${year}`;
                      })()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Configurações Page */}
        {activeMenu === 'configuracoes' && (
          <div className="flex-1 flex flex-col px-8 pt-4 pb-8 overflow-auto">
            <div className="flex-1 flex flex-col items-center justify-center">
              {/* Photo Upload Section */}
              <div className="mb-8">
                <div className="relative w-fit">
                  <div className="w-32 h-32 rounded-full overflow-hidden border-2 border-slate-300">
                    <Image
                      src={userPhoto}
                      alt="Foto do Perfil"
                      width={128}
                      height={128}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <button
                    className="absolute bottom-0 right-0 w-9 h-9 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center transition border-2 border-white shadow-md"
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = 'image/*';
                      input.onchange = async (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (file && auth.currentUser) {
                          try {
                            // Validate image
                            const validationError = await validateImage(file);
                            if (validationError) {
                              alert(validationError.message);
                              return;
                            }

                            // Upload file to Firebase Storage
                            const storageRef = ref(storage, `profiles/${auth.currentUser.uid}/avatar`);
                            await uploadBytes(storageRef, file);

                            // Get download URL
                            const downloadURL = await getDownloadURL(storageRef);

                            // Update user photo state
                            setUserPhoto(downloadURL);

                            // Save to Firestore
                            await setDoc(
                              doc(db, 'users', auth.currentUser.uid),
                              { photoURL: downloadURL },
                              { merge: true }
                            );

                            // Update cache
                            const cachedData = localStorage.getItem('userCache');
                            if (cachedData) {
                              const userData = JSON.parse(cachedData);
                              userData.photoURL = downloadURL;
                              localStorage.setItem('userCache', JSON.stringify(userData));
                            }
                          } catch (err) {
                            console.error('Error uploading photo:', err);
                            alert('Erro ao fazer upload da foto. Tente novamente.');
                          }
                        }
                      };
                      input.click();
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Name Field */}
              <div className="mb-6 w-full max-w-sm">
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Nome
                </label>
                <p className="text-slate-600" style={{ fontFamily: 'var(--font-inter)', fontSize: '14px' }}>
                  {userName || 'Não informado'}
                </p>
              </div>

              {/* Bio Field */}
              <div className="mb-8 w-full max-w-sm">
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Bio
                </label>
                <p className="text-slate-600" style={{ fontFamily: 'var(--font-inter)', fontSize: '14px' }}>
                  {userBio || 'Não informado'}
                </p>
              </div>

              {/* Email Display */}
              <div className="mb-8 w-full max-w-sm">
                <label className="block text-sm font-semibold text-slate-700 mb-2">Email</label>
                <p className="text-slate-600" style={{ fontFamily: 'var(--font-inter)', fontSize: '14px' }}>
                  {userEmail}
                </p>
              </div>

              {/* Edit Button with Pen Icon */}
              <button
                className="flex items-center gap-2 px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg transition"
                onClick={() => {
                  setEditName(userName);
                  setEditBio(userBio);
                  setIsEditDialogOpen(true);
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Editar Perfil
              </button>
            </div>

            {/* Logout Button - Fixed at bottom center */}
            <div className="flex justify-center">
              <Button
                variant="danger"
                size="md"
                style={{
                  backgroundColor: '#E7000B',
                }}
                onClick={handleLogout}
              >
                Sair da Conta
              </Button>
            </div>

            {/* Edit Dialog Modal */}
            {isEditDialogOpen && (
              <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full mx-4">
                  <h3 className="text-xl font-semibold text-slate-900 mb-6">Editar Perfil</h3>

                  {/* Name Input */}
                  <div className="mb-6">
                    <label htmlFor="edit-name" className="block text-sm font-semibold text-slate-700 mb-2">
                      Nome
                    </label>
                    <input
                      id="edit-name"
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Seu nome"
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                      style={{
                        fontFamily: 'var(--font-inter)',
                        fontSize: '14px',
                        fontWeight: 400,
                      }}
                    />
                  </div>

                  {/* Bio Input */}
                  <div className="mb-6">
                    <label htmlFor="edit-bio" className="block text-sm font-semibold text-slate-700 mb-2">
                      Bio
                    </label>
                    <textarea
                      id="edit-bio"
                      value={editBio}
                      onChange={(e) => setEditBio(e.target.value)}
                      placeholder="Uma breve descrição sobre você"
                      rows={3}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition resize-none"
                      style={{
                        fontFamily: 'var(--font-inter)',
                        fontSize: '14px',
                        fontWeight: 400,
                      }}
                    />
                  </div>

                  {/* Buttons */}
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      size="md"
                      fullWidth
                      onClick={() => setIsEditDialogOpen(false)}
                    >
                      Cancelar
                    </Button>
                    <Button
                      variant="primary"
                      size="md"
                      fullWidth
                      onClick={async () => {
                        if (auth.currentUser) {
                          try {
                            await setDoc(
                              doc(db, 'users', auth.currentUser.uid),
                              {
                                name: editName,
                                bio: editBio,
                              },
                              { merge: true }
                            );
                            setUserName(editName);
                            setUserBio(editBio);

                            // Update cache with latest user data
                            const updatedCache = {
                              uid: auth.currentUser.uid,
                              email: userEmail,
                              name: editName,
                              bio: editBio,
                              photoURL: userPhoto,
                              admin: isUserAdmin,
                              createdAt: new Date().toISOString(),
                            };
                            localStorage.setItem('userCache', JSON.stringify(updatedCache));

                            setIsEditDialogOpen(false);
                          } catch (err) {
                            console.error('Error saving profile:', err);
                          }
                        }
                      }}
                    >
                      Salvar
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Administração Page */}
        {activeMenu === 'administracao' && isUserAdmin && (
          <div className="flex-1 overflow-auto px-4 md:px-[110px] pt-6 pb-8" style={{ backgroundColor: '#F8FAFC' }}>
            <div>
              {/* Configuração de Login Card */}
              <div
                className="rounded-3xl border border-slate-200 p-6 flex flex-col gap-4 max-w-2xl"
                style={{
                  backgroundColor: '#FFFFFF',
                  borderColor: '#E2E8F0',
                }}
              >
                  <div className="flex flex-col gap-6">
                    <div>
                      <h3
                        style={{
                          fontFamily: 'var(--font-public-sans)',
                          fontWeight: 600,
                          fontSize: '1rem',
                          color: '#314158',
                          margin: 0,
                          marginBottom: '1rem',
                        }}
                      >
                        Configuração de Login
                      </h3>
                    </div>

                    {/* Login Image Display */}
                    <div>
                      <label
                        style={{
                          fontFamily: 'var(--font-inter)',
                          fontSize: '0.875rem',
                          fontWeight: 500,
                          color: '#314158',
                          display: 'block',
                          marginBottom: '0.5rem',
                        }}
                      >
                        Imagem Configurada
                      </label>
                      <div
                        className="rounded-2xl overflow-hidden border border-slate-200"
                        style={{
                          height: '280px',
                          backgroundColor: '#F8FAFC',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          position: 'relative',
                        }}
                      >
                        {loginImage ? (
                          <Image
                            src={loginImage}
                            alt="Imagem de Login"
                            fill
                            className="object-cover"
                            style={{
                              opacity: loginOpacity / 100,
                              transition: 'opacity 0.3s ease',
                            }}
                          />
                        ) : (
                          <p style={{ color: '#94A3B8', fontFamily: 'var(--font-inter)', fontSize: '0.875rem' }}>
                            Nenhuma imagem configurada
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Image Upload */}
                    <div>
                      <label
                        style={{
                          fontFamily: 'var(--font-inter)',
                          fontSize: '0.875rem',
                          fontWeight: 500,
                          color: '#314158',
                          display: 'block',
                          marginBottom: '0.5rem',
                        }}
                      >
                        Upload de Imagem
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const input = document.createElement('input');
                          input.type = 'file';
                          input.accept = 'image/*';
                          input.onchange = async (e) => {
                            const file = (e.target as HTMLInputElement).files?.[0];
                            if (file && auth.currentUser) {
                              setIsUploadingLoginImage(true);
                              try {
                                // Upload file to Firebase Storage
                                const storageRef = ref(storage, 'login/image_login.png');
                                await uploadBytes(storageRef, file);

                                // Get download URL
                                const downloadURL = await getDownloadURL(storageRef);

                                // Update local state
                                setLoginImage(downloadURL);

                                // Save URL to Firestore
                                await setDoc(
                                  doc(db, 'configs', 'login'),
                                  { image: downloadURL },
                                  { merge: true }
                                );
                              } catch (err) {
                                console.error('Error uploading image:', err);
                                alert('Erro ao fazer upload da imagem. Tente novamente.');
                              } finally {
                                setIsUploadingLoginImage(false);
                              }
                            }
                          };
                          input.click();
                        }}
                        disabled={isUploadingLoginImage}
                        style={{
                          width: '100%',
                          padding: '0.75rem 1rem',
                          borderRadius: '0.5rem',
                          border: '2px dashed #E2E8F0',
                          backgroundColor: '#FFFFFF',
                          fontFamily: 'var(--font-inter)',
                          fontSize: '0.875rem',
                          color: '#314158',
                          cursor: isUploadingLoginImage ? 'not-allowed' : 'pointer',
                          transition: 'all 0.2s',
                          opacity: isUploadingLoginImage ? 0.6 : 1,
                        }}
                      >
                        {isUploadingLoginImage ? '📤 Enviando...' : '📁 Selecionar Imagem'}
                      </button>
                    </div>

                    {/* Opacity Slider */}
                    <div>
                      <label
                        style={{
                          fontFamily: 'var(--font-inter)',
                          fontSize: '0.875rem',
                          fontWeight: 500,
                          color: '#314158',
                          display: 'block',
                          marginBottom: '0.5rem',
                        }}
                      >
                        Opacidade: {loginOpacity}%
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={loginOpacity}
                        onChange={(e) => setLoginOpacity(Number(e.target.value))}
                        className="w-full"
                        style={{
                          height: '6px',
                          borderRadius: '3px',
                          background: '#E2E8F0',
                          outline: 'none',
                          WebkitAppearance: 'none',
                        }}
                      />
                    </div>

                  </div>
              </div>
            </div>
          </div>
        )}

        {/* Integrações Page */}
        {activeMenu === 'integracoes' && (
          <div className="flex-1 overflow-auto px-4 md:px-[110px] pt-6 pb-8" style={{ backgroundColor: '#F8FAFC' }}>
            <div className="flex flex-col gap-6">
              {/* Page Description */}
              <div>
                <p
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    color: '#64748B',
                    margin: 0,
                    maxWidth: '600px',
                  }}
                >
                  Gerencie suas integrações com plataformas externas. Importe dados de outras ferramentas para sincronizar com o sistema.
                </p>
              </div>

              {/* CSV Upload Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <CsvUpload
                  id="hotmart"
                  title="Importar CSV Hotmart"
                  description="Faça upload do arquivo CSV exportado da Hotmart para sincronizar os dados."
                  webhookUrl="https://n8n.hubfy.brandinglab.com.br/webhook/import-hotmart-csv"
                  userEmail={userEmail}
                  onSuccess={(result) => {
                    console.log('Upload Hotmart success:', result);
                  }}
                  onError={(error) => {
                    console.error('Upload Hotmart error:', error);
                  }}
                />

                <CsvUpload
                  id="eduzz"
                  title="Importar CSV Eduzz"
                  description="Faça upload do arquivo CSV exportado da Eduzz para sincronizar os dados."
                  webhookUrl="https://n8n.hubfy.brandinglab.com.br/webhook/import-eduzz-csv"
                  userEmail={userEmail}
                  onSuccess={(result) => {
                    console.log('Upload Eduzz success:', result);
                  }}
                  onError={(error) => {
                    console.error('Upload Eduzz error:', error);
                  }}
                />

                <CsvUpload
                  id="hubla"
                  title="Importar CSV Hubla"
                  description="Faça upload do arquivo CSV exportado da Hubla para sincronizar os dados."
                  webhookUrl="https://n8n.hubfy.brandinglab.com.br/webhook/import-hubla-csv"
                  userEmail={userEmail}
                  onSuccess={(result) => {
                    console.log('Upload Hubla success:', result);
                  }}
                  onError={(error) => {
                    console.error('Upload Hubla error:', error);
                  }}
                />

                <CsvUpload
                  id="kiwify"
                  title="Importar CSV Kiwify"
                  description="Faça upload do arquivo CSV exportado da Kiwify para sincronizar os dados."
                  webhookUrl="https://n8n.hubfy.brandinglab.com.br/webhook/import-kiwify-csv"
                  userEmail={userEmail}
                  onSuccess={(result) => {
                    console.log('Upload Kiwify success:', result);
                  }}
                  onError={(error) => {
                    console.error('Upload Kiwify error:', error);
                  }}
                />

                <CsvUpload
                  id="woocommerce"
                  title="Importar CSV WooCommerce"
                  description="Faça upload do arquivo CSV exportado do WooCommerce para sincronizar os dados."
                  webhookUrl="https://n8n.hubfy.brandinglab.com.br/webhook/import-woo-csv"
                  userEmail={userEmail}
                  onSuccess={(result) => {
                    console.log('Upload WooCommerce success:', result);
                  }}
                  onError={(error) => {
                    console.error('Upload WooCommerce error:', error);
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Placeholder for other menu items */}
        {activeMenu !== 'inicio' && activeMenu !== 'configuracoes' && activeMenu !== 'administracao' && activeMenu !== 'integracoes' && (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center">
              <h2 className="text-2xl font-semibold text-slate-900 mb-2">
                {menuItems.find((m) => m.id === activeMenu)?.label}
              </h2>
              <p className="text-slate-600">Em desenvolvimento...</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
