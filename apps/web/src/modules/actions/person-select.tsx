'use client';

import type { ActionCandidateDto } from '@hse/shared';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

import { actionsService } from './actions.service';

/** O-101: people who can be given actions on the project (search, then pick). */
function useCandidates(projectId: string, search: string): ActionCandidateDto[] {
  const [users, setUsers] = useState<ActionCandidateDto[]>([]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      actionsService.candidates(projectId, search.trim()).then(setUsers, () => undefined);
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [projectId, search]);
  return users;
}

export function PersonSelect({
  id,
  projectId,
  value,
  onChange,
  exclude = [],
  invalid,
  currentName,
}: {
  id: string;
  projectId: string;
  value: string;
  onChange: (userId: string, name: string) => void;
  exclude?: readonly string[];
  invalid?: boolean;
  /** Shown while the current value isn't in the search results. */
  currentName?: string;
}) {
  const t = useTranslations('actions.person');
  const roles = useTranslations('roles');
  const [search, setSearch] = useState('');
  const users = useCandidates(projectId, search).filter((u) => !exclude.includes(u.id));
  const listed = users.some((u) => u.id === value);
  return (
    <div className="flex flex-col gap-2">
      <Input
        id={`${id}-search`}
        type="search"
        aria-label={t('search')}
        placeholder={t('search')}
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
      />
      <Select
        id={id}
        value={value}
        invalid={invalid}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(event) => {
          const chosen = users.find((u) => u.id === event.target.value);
          onChange(event.target.value, chosen?.name ?? '');
        }}
      >
        <option value="">{t('choose')}</option>
        {value && !listed && currentName ? <option value={value}>{currentName}</option> : null}
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name} · {roles(user.roleCode as 'worker')}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Up to `max` people, as removable chips plus a picker. */
export function PeopleField({
  id,
  projectId,
  people,
  onChange,
  exclude,
  max,
}: {
  id: string;
  projectId: string;
  people: { id: string; name: string }[];
  onChange: (people: { id: string; name: string }[]) => void;
  exclude: readonly string[];
  max: number;
}) {
  const t = useTranslations('actions.person');
  return (
    <div className="flex flex-col gap-2">
      {people.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {people.map((person) => (
            <li
              key={person.id}
              className="inline-flex items-center gap-1 rounded-full border border-border ps-3"
            >
              {person.name}
              <button
                type="button"
                aria-label={t('remove', { name: person.name })}
                className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-full hover:bg-muted"
                onClick={() => {
                  onChange(people.filter((p) => p.id !== person.id));
                }}
              >
                <X aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {people.length < max ? (
        <PersonSelect
          id={id}
          projectId={projectId}
          value=""
          exclude={[...exclude, ...people.map((p) => p.id)]}
          onChange={(userId, name) => {
            if (userId) onChange([...people, { id: userId, name }]);
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">{t('limit', { max })}</p>
      )}
    </div>
  );
}
