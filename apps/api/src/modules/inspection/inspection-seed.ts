import type { LocalizedText, TemplateContent } from '@hse/shared';

/** O-141: the twelve inspection types of Doc 10 §3, in both languages. */
export const SEED_CATEGORIES: readonly { key: string; en: string; ar: string }[] = [
  { key: 'daily_safety', en: 'Daily Safety Inspection', ar: 'التفتيش اليومي على السلامة' },
  { key: 'weekly_safety', en: 'Weekly Safety Inspection', ar: 'التفتيش الأسبوعي على السلامة' },
  { key: 'environmental', en: 'Environmental Inspection', ar: 'التفتيش البيئي' },
  { key: 'fire_safety', en: 'Fire Safety Inspection', ar: 'تفتيش السلامة من الحريق' },
  { key: 'ppe', en: 'PPE Inspection', ar: 'تفتيش معدات الوقاية الشخصية' },
  { key: 'scaffold', en: 'Scaffold Inspection', ar: 'تفتيش السقالات' },
  { key: 'excavation', en: 'Excavation Inspection', ar: 'تفتيش الحفريات' },
  { key: 'lifting', en: 'Lifting Inspection', ar: 'تفتيش عمليات الرفع' },
  { key: 'electrical', en: 'Electrical Inspection', ar: 'التفتيش الكهربائي' },
  { key: 'vehicle', en: 'Vehicle Inspection', ar: 'تفتيش المركبات' },
  { key: 'camp', en: 'Camp Inspection', ar: 'تفتيش السكن' },
  { key: 'welfare', en: 'Welfare Inspection', ar: 'تفتيش مرافق الرعاية' },
];

export const STARTER_TEMPLATE = {
  key: 'daily_site_safety',
  categoryKey: 'daily_safety',
  nameEn: 'Daily Site Safety Inspection',
  nameAr: 'التفتيش اليومي على سلامة الموقع',
};

type Item = [en: string, ar: string, critical?: boolean];

/** O-142: the Doc 10 §7 sections (draft wording, to be confirmed by the Product Owner). */
const SECTIONS: readonly { title: LocalizedText; items: readonly Item[] }[] = [
  {
    title: { en: 'General Safety', ar: 'السلامة العامة' },
    items: [
      ['Site access controlled', 'الدخول إلى الموقع مضبوط'],
      ['Safety signage in place', 'لافتات السلامة موجودة'],
      ['Emergency contacts displayed', 'أرقام الطوارئ معروضة'],
      ['First-aid kit stocked', 'حقيبة الإسعافات الأولية مجهزة'],
    ],
  },
  {
    title: { en: 'Housekeeping', ar: 'النظافة والترتيب' },
    items: [
      ['Walkways clear', 'الممرات خالية من العوائق'],
      ['Materials stored safely', 'المواد مخزنة بأمان'],
      ['Waste segregated and removed', 'النفايات مفرزة ومزالة'],
      ['No trip hazards', 'لا توجد مخاطر تعثر'],
    ],
  },
  {
    title: { en: 'PPE', ar: 'معدات الوقاية الشخصية' },
    items: [
      ['Hard hats worn', 'الخوذات مرتداة'],
      ['Safety footwear worn', 'أحذية السلامة مرتداة'],
      ['High-visibility clothing worn', 'الملابس عاكسة الرؤية مرتداة'],
      ['Task-specific PPE in use', 'معدات الوقاية الخاصة بالمهمة مستخدمة'],
    ],
  },
  {
    title: { en: 'Electrical Safety', ar: 'السلامة الكهربائية' },
    items: [
      ['Cables undamaged and routed safely', 'الكابلات سليمة وممدودة بأمان'],
      ['Distribution boards closed and labelled', 'لوحات التوزيع مغلقة ومعلمة'],
      ['RCD protection in use', 'قواطع التسرب الأرضي مستخدمة'],
      ['Portable tools tested', 'الأدوات المحمولة مفحوصة'],
    ],
  },
  {
    title: { en: 'Working at Height', ar: 'العمل على المرتفعات' },
    items: [
      ['Edge protection in place', 'حماية الحواف موجودة', true],
      ['Scaffolds tagged', 'السقالات موسومة'],
      ['Harnesses worn and anchored', 'أحزمة الأمان مرتداة ومثبتة', true],
      ['Ladders in good condition', 'السلالم بحالة جيدة'],
    ],
  },
  {
    title: { en: 'Fire Protection', ar: 'الحماية من الحريق' },
    items: [
      ['Extinguishers available and in date', 'طفايات الحريق متوفرة وصالحة'],
      ['Hot work permit in place', 'تصريح الأعمال الساخنة موجود'],
      ['Escape routes clear', 'طرق الإخلاء خالية'],
      ['Flammables stored correctly', 'المواد القابلة للاشتعال مخزنة بشكل صحيح'],
    ],
  },
  {
    title: { en: 'Environmental Controls', ar: 'الضوابط البيئية' },
    items: [
      ['Dust controlled', 'الغبار تحت السيطرة'],
      ['Spill kits available', 'أطقم التعامل مع الانسكابات متوفرة'],
      ['No leaks or spills', 'لا توجد تسربات أو انسكابات'],
      ['Noise controls in use', 'ضوابط الضوضاء مستخدمة'],
    ],
  },
];

/** The starter content with fresh keys (each company gets its own). */
export function starterContent(newId: () => string): TemplateContent {
  return {
    description: {
      en: 'A daily walk-round of the site covering the main hazards.',
      ar: 'جولة يومية في الموقع تغطي المخاطر الرئيسية.',
    },
    results: ['pass', 'fail', 'not_applicable'],
    scoring: { method: 'percentage', passMark: 85 },
    needsApproval: true,
    areaRequired: false,
    sections: SECTIONS.map((section) => ({
      key: newId(),
      title: section.title,
      items: section.items.map(([en, ar, critical]) => ({
        key: newId(),
        question: { en, ar },
        expected: null,
        guidance: null,
        weight: critical ? 3 : 1,
        critical: critical ?? false,
        defaultPriority: critical ? 'high' : 'medium',
        photoOnFail: true,
        photoAlways: false,
      })),
    })),
  };
}
