'use client';

import { useEffect } from 'react';

import { useAuth } from '@/modules/auth/auth-provider';
import { useCompany } from '@/modules/tenant/tenant-provider';

import { hasLanguageCookie, useLanguage } from './use-language';

/**
 * Applies the language precedence of PLT-03 / D-21:
 * signed-in user's saved preference → device choice (cookie) → company default → English.
 */
export function LanguageSync() {
  const { applyLanguage } = useLanguage();
  const { user } = useAuth();
  const company = useCompany();

  useEffect(() => {
    if (company && !hasLanguageCookie()) applyLanguage(company.defaultLanguage);
  }, [company, applyLanguage]);

  useEffect(() => {
    if (user?.preferredLanguage) applyLanguage(user.preferredLanguage);
  }, [user?.preferredLanguage, applyLanguage]);

  return null;
}
