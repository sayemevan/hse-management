import { notFound } from 'next/navigation';

import { PlacePickerDemo } from '@/modules/projects/place-picker-demo';

/** US-021: the place picker on its own, in development builds only (later forms use it). */
export default function PlacePickerPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <PlacePickerDemo />;
}
