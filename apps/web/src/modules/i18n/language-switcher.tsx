'use client';

import { type Language, LANGUAGES } from '@hse/shared';
import { Languages } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { authService } from '@/modules/auth/auth.service';
import { useAuth } from '@/modules/auth/auth-provider';
import { cn } from '@/utils/cn';

import { useLanguage } from './use-language';

/**
 * Switches between العربية and English (PLT-03). Once signed in, the choice is also saved
 * to the user profile so it follows the user to every device (D-21).
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const t = useTranslations('language');
  const { language, applyLanguage } = useLanguage();
  const { status, setUser } = useAuth();

  const choose = (next: Language) => {
    applyLanguage(next);
    if (status === 'signed-in') {
      authService
        .setPreferredLanguage(next)
        .then(setUser)
        .catch(() => {
          // The device preference already applied; the profile is updated on the next change.
        });
    }
  };

  return (
    <div
      role="group"
      aria-label={t('label')}
      className={cn('inline-flex items-center gap-1', className)}
    >
      <Languages aria-hidden className="size-5 text-muted-foreground" />
      {LANGUAGES.map((option) => (
        <button
          key={option}
          type="button"
          lang={option}
          aria-pressed={option === language}
          onClick={() => {
            choose(option);
          }}
          className={cn(
            'min-h-10 rounded-md px-3 text-sm',
            option === language
              ? 'bg-muted font-semibold text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t(option)}
        </button>
      ))}
    </div>
  );
}
