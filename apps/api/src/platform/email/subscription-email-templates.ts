import type { Language } from '@hse/shared';
import { z } from 'zod';

import type { EmailContent } from './email-layout';
import { define, footer, formatAmount, formatDate } from './template-kit';

/** Subscription emails (PLT-15, O-35): reminders before each deadline, payment outcomes. */

const bankDetails = z.object({ bankName: z.string(), beneficiary: z.string(), iban: z.string() });
type BankDetails = z.output<typeof bankDetails>;

const reminderData = z.object({
  fullName: z.string(),
  companyName: z.string(),
  deadline: z.number(),
  timeZone: z.string(),
  daysLeft: z.number().int().nonnegative(),
  subscriptionUrl: z.url(),
  bank: bankDetails,
});
type ReminderData = z.output<typeof reminderData>;

const cycleData = z.enum(['monthly', 'annual']);

function bankLines(language: Language, bank: BankDetails): string[] {
  return language === 'ar'
    ? [
        `بيانات التحويل البنكي — البنك: ${bank.bankName}، المستفيد: ${bank.beneficiary}، رقم الآيبان: ${bank.iban}.`,
        'بعد التحويل، ارفع إيصال الدفع من صفحة الاشتراك.',
      ]
    : [
        `Bank transfer details — bank: ${bank.bankName}, beneficiary: ${bank.beneficiary}, IBAN: ${bank.iban}.`,
        'After the transfer, upload the receipt on the subscription page.',
      ];
}

function inDays(language: Language, days: number): string {
  if (language === 'ar') {
    if (days === 0) return 'اليوم';
    if (days === 1) return 'غدًا';
    return `خلال ${days} أيام`;
  }
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/** The six date-based reminders share one shape: what ends, when, and how to pay. */
function reminder(text: {
  en: (data: ReminderData, when: string) => { subject: string; lead: string };
  ar: (data: ReminderData, when: string) => { subject: string; lead: string };
}) {
  return define({
    data: reminderData,
    secrets: null,
    content: (language, data): EmailContent => {
      const when = formatDate(language, data.deadline, data.timeZone);
      const { subject, lead } = text[language](data, when);
      return {
        subject,
        heading: language === 'ar' ? `مرحبًا ${data.fullName}،` : `Hello ${data.fullName},`,
        paragraphs: [lead, ...bankLines(language, data.bank)],
        action: {
          label: language === 'ar' ? 'فتح صفحة الاشتراك' : 'Open the subscription page',
          url: data.subscriptionUrl,
        },
        footer: footer[language],
      };
    },
  });
}

const KEPT_AR = 'تبقى جميع بياناتك محفوظة ويمكن الاطلاع عليها.';
const KEPT_EN = 'All your data is kept and can still be viewed.';

export const SUBSCRIPTION_EMAIL_TEMPLATES = {
  'subscription.trial_ending': reminder({
    en: (d, when) => ({
      subject: `Your trial ends ${inDays('en', d.daysLeft)} — ${d.companyName}`,
      lead: `The free trial of ${d.companyName} ends on ${when}. Pay before then to keep working without interruption; otherwise the workspace becomes read-only. ${KEPT_EN}`,
    }),
    ar: (d, when) => ({
      subject: `تنتهي الفترة التجريبية ${inDays('ar', d.daysLeft)} — ${d.companyName}`,
      lead: `تنتهي الفترة التجريبية المجانية لـ ${d.companyName} في ${when}. ادفع قبل ذلك لمواصلة العمل دون انقطاع، وإلا تصبح مساحة العمل للقراءة فقط. ${KEPT_AR}`,
    }),
  }),
  'subscription.trial_ended': reminder({
    en: (d, when) => ({
      subject: `Action needed: ${d.companyName} is now read-only`,
      lead: `The free trial of ${d.companyName} ended on ${when} without a payment, so the workspace is now read-only: everyone can view, but nothing can be added or changed. ${KEPT_EN} It becomes fully available again as soon as the payment is confirmed.`,
    }),
    ar: (d, when) => ({
      subject: `إجراء مطلوب: ${d.companyName} للقراءة فقط الآن`,
      lead: `انتهت الفترة التجريبية المجانية لـ ${d.companyName} في ${when} دون دفع، لذا أصبحت مساحة العمل للقراءة فقط: يمكن للجميع الاطلاع، لكن لا يمكن إضافة أو تعديل أي شيء. ${KEPT_AR} تعود متاحة بالكامل فور تأكيد الدفع.`,
    }),
  }),
  'subscription.renewal_due': reminder({
    en: (d, when) => ({
      subject: `Your subscription renews ${inDays('en', d.daysLeft)} — ${d.companyName}`,
      lead: `The current subscription period of ${d.companyName} ends on ${when}. Pay for the next period before then to keep working without interruption.`,
    }),
    ar: (d, when) => ({
      subject: `يحين تجديد اشتراكك ${inDays('ar', d.daysLeft)} — ${d.companyName}`,
      lead: `تنتهي فترة الاشتراك الحالية لـ ${d.companyName} في ${when}. ادفع للفترة التالية قبل ذلك لمواصلة العمل دون انقطاع.`,
    }),
  }),
  'subscription.grace_started': reminder({
    en: (d, when) => ({
      subject: `Your subscription has ended — pay by ${when}`,
      lead: `The subscription of ${d.companyName} has ended. You can keep working until ${when}; after that the workspace becomes read-only. ${KEPT_EN}`,
    }),
    ar: (d, when) => ({
      subject: `انتهى اشتراكك — ادفع قبل ${when}`,
      lead: `انتهى اشتراك ${d.companyName}. يمكنك مواصلة العمل حتى ${when}، وبعدها تصبح مساحة العمل للقراءة فقط. ${KEPT_AR}`,
    }),
  }),
  'subscription.grace_ending': reminder({
    en: (d, when) => ({
      subject: `${d.companyName} becomes read-only ${inDays('en', d.daysLeft)}`,
      lead: `The subscription of ${d.companyName} hasn't been renewed. On ${when} the workspace becomes read-only. ${KEPT_EN}`,
    }),
    ar: (d, when) => ({
      subject: `تصبح ${d.companyName} للقراءة فقط ${inDays('ar', d.daysLeft)}`,
      lead: `لم يُجدَّد اشتراك ${d.companyName}. في ${when} تصبح مساحة العمل للقراءة فقط. ${KEPT_AR}`,
    }),
  }),
  'subscription.read_only_started': reminder({
    en: (d, when) => ({
      subject: `Action needed: ${d.companyName} is now read-only`,
      lead: `The subscription of ${d.companyName} wasn't renewed, so since ${when} the workspace is read-only: everyone can view, but nothing can be added or changed. ${KEPT_EN} It becomes fully available again as soon as the payment is confirmed.`,
    }),
    ar: (d, when) => ({
      subject: `إجراء مطلوب: ${d.companyName} للقراءة فقط الآن`,
      lead: `لم يُجدَّد اشتراك ${d.companyName}، لذا أصبحت مساحة العمل للقراءة فقط منذ ${when}: يمكن للجميع الاطلاع، لكن لا يمكن إضافة أو تعديل أي شيء. ${KEPT_AR} تعود متاحة بالكامل فور تأكيد الدفع.`,
    }),
  }),

  'payment.submitted': define({
    data: z.object({
      fullName: z.string(),
      companyName: z.string(),
      planName: z.string(),
      billingCycle: cycleData,
      amount: z.number(),
      reviewUrl: z.url(),
    }),
    secrets: null,
    content: (language, data) => {
      const amount = formatAmount(language, data.amount);
      return language === 'ar'
        ? {
            subject: `إيصال دفع جديد من ${data.companyName}`,
            heading: `مرحبًا ${data.fullName}،`,
            paragraphs: [
              `أرسلت ${data.companyName} إيصال دفع بمبلغ ${amount} لخطة ${data.planName} (${data.billingCycle === 'monthly' ? 'شهري' : 'سنوي'}).`,
            ],
            action: { label: 'مراجعة الدفع', url: data.reviewUrl },
            footer: footer.ar,
          }
        : {
            subject: `New payment proof from ${data.companyName}`,
            heading: `Hello ${data.fullName},`,
            paragraphs: [
              `${data.companyName} sent a payment proof of ${amount} for the ${data.planName} plan (${data.billingCycle}).`,
            ],
            action: { label: 'Review payment', url: data.reviewUrl },
            footer: footer.en,
          };
    },
  }),

  'payment.confirmed': define({
    data: z.object({
      fullName: z.string(),
      companyName: z.string(),
      planName: z.string(),
      billingCycle: cycleData,
      amount: z.number(),
      periodEnd: z.number(),
      timeZone: z.string(),
      subscriptionUrl: z.url(),
    }),
    secrets: null,
    content: (language, data) => {
      const amount = formatAmount(language, data.amount);
      const until = formatDate(language, data.periodEnd, data.timeZone);
      return language === 'ar'
        ? {
            subject: `تم تأكيد الدفع — ${data.companyName} فعّالة حتى ${until}`,
            heading: `مرحبًا ${data.fullName}،`,
            paragraphs: [
              `أكّدنا استلام ${amount}. اشتراك ${data.companyName} في خطة ${data.planName} (${data.billingCycle === 'monthly' ? 'شهري' : 'سنوي'}) فعّال حتى ${until}.`,
              'شكرًا لك.',
            ],
            action: { label: 'فتح صفحة الاشتراك', url: data.subscriptionUrl },
            footer: footer.ar,
          }
        : {
            subject: `Payment confirmed — ${data.companyName} is active until ${until}`,
            heading: `Hello ${data.fullName},`,
            paragraphs: [
              `We confirmed receipt of ${amount}. The ${data.planName} subscription (${data.billingCycle}) of ${data.companyName} is active until ${until}.`,
              'Thank you.',
            ],
            action: { label: 'Open the subscription page', url: data.subscriptionUrl },
            footer: footer.en,
          };
    },
  }),

  'payment.rejected': define({
    data: z.object({
      fullName: z.string(),
      companyName: z.string(),
      reason: z.string(),
      subscriptionUrl: z.url(),
    }),
    secrets: null,
    content: (language, data) =>
      language === 'ar'
        ? {
            subject: `لم نتمكن من تأكيد الدفع — ${data.companyName}`,
            heading: `مرحبًا ${data.fullName}،`,
            paragraphs: [
              'راجعنا إيصال الدفع ولم نتمكن من تأكيده للسبب التالي:',
              'يمكنك إرسال إيصال جديد من صفحة الاشتراك.',
            ],
            quote: data.reason,
            action: { label: 'إرسال الدفع مرة أخرى', url: data.subscriptionUrl },
            footer: footer.ar,
          }
        : {
            subject: `We couldn't confirm your payment — ${data.companyName}`,
            heading: `Hello ${data.fullName},`,
            paragraphs: [
              'We reviewed your payment proof and could not confirm it, for this reason:',
              'You can send a new one from the subscription page.',
            ],
            quote: data.reason,
            action: { label: 'Submit again', url: data.subscriptionUrl },
            footer: footer.en,
          },
  }),
} as const;
