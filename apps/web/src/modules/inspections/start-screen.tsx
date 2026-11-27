'use client';

import {
  acceptsRecords,
  INSPECTION_WEATHER,
  type InspectionWeather,
  type OfflinePackDto,
  type OfflineProfileDto,
  type OfflineProjectDto,
  type PlaceDto,
  type ProjectStatus,
  type TemplatePackVersionDto,
  zonedIsoDate,
} from '@hse/shared';
import { LocateFixed } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';

import { FormField } from '@/components/form/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/modules/auth/auth-provider';
import { authorizedRequest } from '@/modules/auth/auth-session';
import { readReference } from '@/modules/offline/device-store';
import { refreshProjectPack, storedProfile } from '@/modules/offline/offline-profile';
import { useSync } from '@/modules/offline/sync-provider';
import { useCompany } from '@/modules/tenant/tenant-provider';

import { captureHref, queueStart, readTemplatePack, refreshTemplatePack } from './inspection-offline';
import { useLocalized } from './inspection-ui';

interface Location {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

/** US-033: start an inspection on the spot — works offline from the device's packs (T-80). */
export function StartInspectionScreen() {
  const t = useTranslations('inspections.startScreen');
  const tw = useTranslations('inspections.weather');
  const tc = useTranslations('common');
  const params = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const company = useCompany();
  const { online, refresh } = useSync();
  const pick = useLocalized();
  const projectFieldId = useId();
  const templateFieldId = useId();
  const areaFieldId = useId();
  const locationFieldId = useId();
  const dateFieldId = useId();
  const weatherFieldId = useId();
  const [projects, setProjects] = useState<OfflineProjectDto[] | null>(null);
  const [versions, setVersions] = useState<TemplatePackVersionDto[]>([]);
  const [projectId, setProjectId] = useState(params.get('project') ?? '');
  const [pack, setPack] = useState<OfflinePackDto | null>(null);
  const [versionId, setVersionId] = useState('');
  const [areaId, setAreaId] = useState('');
  const [locationId, setLocationId] = useState('');
  const today = zonedIsoDate(Date.now(), company?.timeZone ?? 'UTC');
  const [inspectedOn, setInspectedOn] = useState(today);
  const [weather, setWeather] = useState<InspectionWeather | ''>('');
  const [location, setLocation] = useState<Location | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      // Online, ask the server: right after sign-in the device profile may not be saved yet.
      const live = online
        ? await authorizedRequest<OfflineProfileDto>('/me/offline-profile').then((r) => r.data).catch(() => null)
        : null;
      const profile = live ?? (await storedProfile(user.id));
      setProjects(
        (profile?.projects ?? []).filter(
          (p) =>
            p.permissions.includes('projects.inspections.conduct') &&
            acceptsRecords(p.status as ProjectStatus),
        ),
      );
      const templates = (online ? await refreshTemplatePack(user.id) : null) ?? (await readTemplatePack(user.id));
      setVersions((templates?.versions ?? []).filter((v) => v.current));
    })();
  }, [user, online]);

  useEffect(() => {
    if (!user || !projectId) return;
    void (async () => {
      if (online) await refreshProjectPack(user.id, projectId, {});
      const row = await readReference<OfflinePackDto>(user.id, 'project-pack', projectId);
      setPack(row?.data ?? null);
      setAreaId('');
      setLocationId('');
    })();
  }, [user, projectId, online]);

  if (!user || projects === null) {
    return (
      <div className="flex items-center gap-3" role="status">
        <Spinner />
        {tc('loading')}
      </div>
    );
  }

  const project = projects.find((p) => p.id === projectId) ?? null;
  const version = versions.find((v) => v.versionId === versionId) ?? null;
  const areas: PlaceDto[] = (pack?.places.areas ?? []).filter((a) => a.active);
  const area = areas.find((a) => a.id === areaId) ?? null;
  const locations = (area?.children ?? []).filter((l) => l.active);

  const start = async () => {
    if (!project || !version) {
      setError(t('required'));
      return;
    }
    if (version.content.areaRequired && !areaId) {
      setError(t('areaRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const placeName = [area?.name, locations.find((l) => l.id === locationId)?.name].filter(Boolean).join(' › ') || null;
      const copy = await queueStart(user.id, {
        project: { id: project.id, code: project.code },
        version,
        place: { areaId: areaId || null, locationId: locationId || null, workZoneId: null },
        placeName,
        inspectedOn,
        weather: weather || null,
        location,
      });
      await refresh();
      router.push(captureHref(copy.projectId, copy.id));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      {!online ? <Alert tone="info">{t('offline')}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {projects.length === 0 ? <Alert tone="warning">{t('noProjects')}</Alert> : null}
      <FormField id={projectFieldId} label={t('project')}>
        <Select id={projectFieldId} value={projectId} onChange={(e) => { setProjectId(e.target.value); }}>
          <option value="">{t('chooseProject')}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </Select>
      </FormField>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium" id={templateFieldId}>{t('template')}</legend>
        {versions.length === 0 ? <p className="text-sm text-muted-foreground">{t('noTemplates')}</p> : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {versions.map((v) => (
            <button
              key={v.versionId}
              type="button"
              aria-pressed={versionId === v.versionId}
              onClick={() => { setVersionId(v.versionId); }}
              className={`flex min-h-16 flex-col items-start gap-1 rounded-xl border p-3 text-start ${
                versionId === v.versionId ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'
              }`}
            >
              <span className="font-medium">{pick({ en: v.nameEn, ar: v.nameAr })}</span>
              <span className="text-sm text-muted-foreground">
                {pick({ en: v.categoryNameEn, ar: v.categoryNameAr })} ·{' '}
                {t('items', { count: v.content.sections.reduce((n, s) => n + s.items.length, 0) })}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      {project ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id={areaFieldId} label={version?.content.areaRequired ? t('areaRequiredLabel') : t('area')}>
            <Select id={areaFieldId} value={areaId} onChange={(e) => { setAreaId(e.target.value); setLocationId(''); }}>
              <option value="">{t('noArea')}</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </FormField>
          {locations.length > 0 ? (
            <FormField id={locationFieldId} label={t('location')}>
              <Select id={locationFieldId} value={locationId} onChange={(e) => { setLocationId(e.target.value); }}>
                <option value="">{t('noLocation')}</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </Select>
            </FormField>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id={dateFieldId} label={t('date')}>
          <Input id={dateFieldId} type="date" max={today} value={inspectedOn} onChange={(e) => { setInspectedOn(e.target.value); }} />
        </FormField>
        <FormField id={weatherFieldId} label={t('weather')}>
          <Select id={weatherFieldId} value={weather} onChange={(e) => { setWeather(e.target.value as InspectionWeather | ''); }}>
            <option value="">{t('noWeather')}</option>
            {INSPECTION_WEATHER.map((w) => (
              <option key={w} value={w}>{tw(w)}</option>
            ))}
          </Select>
        </FormField>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          disabled={locating || typeof navigator === 'undefined' || !('geolocation' in navigator)}
          onClick={() => {
            setLocating(true);
            navigator.geolocation.getCurrentPosition(
              (position) => {
                setLocation({
                  latitude: position.coords.latitude,
                  longitude: position.coords.longitude,
                  accuracy: Math.round(position.coords.accuracy),
                });
                setLocating(false);
              },
              () => {
                setError(t('locationFailed'));
                setLocating(false);
              },
              { enableHighAccuracy: true, timeout: 15000 },
            );
          }}
        >
          <LocateFixed aria-hidden className="size-5" />
          {location ? t('locationAgain') : t('addLocation')}
        </Button>
        {location ? (
          <span className="text-sm text-muted-foreground">
            <bdi dir="ltr">{t('accuracy', { metres: location.accuracy ?? 0 })}</bdi>
          </span>
        ) : null}
      </div>

      <Button disabled={saving || !project || !version} onClick={() => void start()}>
        {saving ? <Spinner /> : null}
        {t('start')}
      </Button>
    </div>
  );
}
