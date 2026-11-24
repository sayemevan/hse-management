import type { Language } from '@hse/shared';
import { z } from 'zod';

import { renderLayout, type RenderedEmail } from './email-layout';

import { SUBSCRIPTION_EMAIL_TEMPLATES } from './subscription-email-templates';
import { define, footer, formatDate, type TemplateDefinition } from './template-kit';

/** Email templates (PLT-05, T-12). Sprint 4 adds the subscription templates (PLT-15). */
export const EMAIL_TEMPLATES = {
  'registration.verify_email': define({
    data: z.object({ applicantName: z.string(), companyName: z.string() }),
    secrets: z.object({ verifyUrl: z.url() }),
    content: (language, data, secrets) =>
      language === 'ar'
        ? {
            subject: 'أكّد بريدك الإلكتروني لإكمال تسجيل شركتك',
            heading: `مرحبًا ${data.applicantName}،`,
            paragraphs: [
              `شكرًا لتسجيل ${data.companyName}. اضغط على الزر أدناه لتأكيد بريدك الإلكتروني وإرسال طلبك للمراجعة.`,
              'ينتهي هذا الرابط خلال 24 ساعة ويمكن استخدامه مرة واحدة فقط.',
            ],
            action: { label: 'تأكيد البريد الإلكتروني', url: secrets.verifyUrl },
            footer: footer.ar,
          }
        : {
            subject: 'Confirm your email to finish registering your company',
            heading: `Hello ${data.applicantName},`,
            paragraphs: [
              `Thank you for registering ${data.companyName}. Select the button below to confirm your email and send your application for review.`,
              'This link expires in 24 hours and works only once.',
            ],
            action: { label: 'Confirm email', url: secrets.verifyUrl },
            footer: footer.en,
          },
  }),

  'registration.already_exists': define({
    data: z.object({ platformUrl: z.url() }),
    secrets: null,
    content: (language, data) =>
      language === 'ar'
        ? {
            subject: 'محاولة تسجيل باستخدام بريدك الإلكتروني',
            heading: 'هذا البريد الإلكتروني مستخدم بالفعل',
            paragraphs: [
              'حاول شخص ما تسجيل شركة جديدة بهذا البريد الإلكتروني، لكنه مرتبط بالفعل بحساب أو بطلب قائم.',
              'إذا كان لديك حساب، سجّل الدخول على عنوان شركتك. وإذا كان لديك طلب لم يُؤكَّد بعد، فاطلب رابط تأكيد جديدًا من صفحة التسجيل.',
            ],
            action: { label: 'الذهاب إلى المنصة', url: data.platformUrl },
            footer: footer.ar,
          }
        : {
            subject: 'Someone tried to register with your email',
            heading: 'This email is already in use',
            paragraphs: [
              'Someone tried to register a new company with this email, but it already belongs to an account or an open application.',
              'If you have an account, sign in at your company address. If you have an application that is not confirmed yet, request a new confirmation link from the registration page.',
            ],
            action: { label: 'Go to the platform', url: data.platformUrl },
            footer: footer.en,
          },
  }),

  'registration.submitted': define({
    data: z.object({ applicantName: z.string(), companyName: z.string() }),
    secrets: null,
    content: (language, data) =>
      language === 'ar'
        ? {
            subject: 'تم استلام طلب تسجيل شركتك',
            heading: `شكرًا ${data.applicantName}`,
            paragraphs: [
              `تم تأكيد بريدك الإلكتروني وأُرسل طلب ${data.companyName} للمراجعة.`,
              'سنتواصل معك هاتفيًا للتحقق من رقمك، ثم نرسل إليك رسالة بالنتيجة.',
            ],
            footer: footer.ar,
          }
        : {
            subject: 'We have received your company registration',
            heading: `Thank you, ${data.applicantName}`,
            paragraphs: [
              `Your email is confirmed and the application for ${data.companyName} has been sent for review.`,
              'We will call you to confirm your phone number, then email you the result.',
            ],
            footer: footer.en,
          },
  }),

  'registration.new_for_review': define({
    data: z.object({
      companyName: z.string(),
      slug: z.string(),
      applicantName: z.string(),
      reviewUrl: z.url(),
    }),
    secrets: null,
    content: (language, data) =>
      language === 'ar'
        ? {
            subject: `طلب تسجيل جديد: ${data.companyName}`,
            heading: 'طلب تسجيل بانتظار المراجعة',
            paragraphs: [
              `قدّم ${data.applicantName} طلبًا لتسجيل ${data.companyName} بالعنوان ${data.slug}.`,
            ],
            action: { label: 'مراجعة الطلب', url: data.reviewUrl },
            footer: footer.ar,
          }
        : {
            subject: `New registration: ${data.companyName}`,
            heading: 'A registration is waiting for review',
            paragraphs: [
              `${data.applicantName} applied to register ${data.companyName} at the address ${data.slug}.`,
            ],
            action: { label: 'Review application', url: data.reviewUrl },
            footer: footer.en,
          },
  }),

  'registration.approved': define({
    data: z.object({
      applicantName: z.string(),
      companyName: z.string(),
      signInUrl: z.url(),
      trialEndsAt: z.number(),
      timeZone: z.string(),
    }),
    secrets: null,
    content: (language, data) => {
      const trialEnd = formatDate(language, data.trialEndsAt, data.timeZone);
      return language === 'ar'
        ? {
            subject: `تمت الموافقة على ${data.companyName}`,
            heading: `مرحبًا ${data.applicantName}، أصبحت شركتك جاهزة`,
            paragraphs: [
              `تمت الموافقة على طلب ${data.companyName}. يمكنك الآن تسجيل الدخول بالبريد الإلكتروني وكلمة المرور اللذين استخدمتهما عند التسجيل.`,
              `تبدأ فترتك التجريبية المجانية اليوم وتنتهي في ${trialEnd}.`,
            ],
            action: { label: 'تسجيل الدخول', url: data.signInUrl },
            footer: footer.ar,
          }
        : {
            subject: `${data.companyName} has been approved`,
            heading: `Hello ${data.applicantName}, your company is ready`,
            paragraphs: [
              `The application for ${data.companyName} has been approved. You can now sign in with the email and password you used to register.`,
              `Your free trial starts today and ends on ${trialEnd}.`,
            ],
            action: { label: 'Sign in', url: data.signInUrl },
            footer: footer.en,
          };
    },
  }),

  'registration.rejected': define({
    data: z.object({ applicantName: z.string(), companyName: z.string(), reason: z.string() }),
    secrets: z.object({ resubmitUrl: z.url() }),
    content: (language, data, secrets) =>
      language === 'ar'
        ? {
            subject: `يلزم إجراء تعديلات على طلب ${data.companyName}`,
            heading: `مرحبًا ${data.applicantName}،`,
            paragraphs: [
              `لم نتمكن من الموافقة على طلب ${data.companyName} حتى الآن. هذا ما طلبه فريقنا:`,
            ],
            quote: data.reason,
            action: { label: 'تعديل الطلب وإعادة إرساله', url: secrets.resubmitUrl },
            footer: `يعمل هذا الرابط لمدة 30 يومًا. ${footer.ar}`,
          }
        : {
            subject: `Changes needed for ${data.companyName}`,
            heading: `Hello ${data.applicantName},`,
            paragraphs: [
              `We couldn't approve the application for ${data.companyName} yet. This is what our team asked for:`,
            ],
            quote: data.reason,
            action: { label: 'Update and resubmit', url: secrets.resubmitUrl },
            footer: `This link works for 30 days. ${footer.en}`,
          },
  }),
  // ---- Sprint 3: users and passwords (US-006, US-002, US-003) ----

  'user.invitation': define({
    data: z.object({
      fullName: z.string(),
      companyName: z.string(),
      invitedByName: z.string(),
      expiresAt: z.number(),
      timeZone: z.string(),
    }),
    secrets: z.object({ acceptUrl: z.url() }),
    content: (language, data, secrets) => {
      const expiry = formatDate(language, data.expiresAt, data.timeZone);
      return language === 'ar'
        ? {
            subject: `دعوة للانضمام إلى ${data.companyName}`,
            heading: `مرحبًا ${data.fullName}،`,
            paragraphs: [
              `دعاك ${data.invitedByName} للانضمام إلى ${data.companyName} على منصة إدارة الصحة والسلامة والبيئة.`,
              'اضغط على الزر أدناه لتعيين كلمة المرور وتفعيل حسابك.',
              `تنتهي هذه الدعوة في ${expiry} ويمكن استخدامها مرة واحدة فقط.`,
            ],
            action: { label: 'تفعيل الحساب', url: secrets.acceptUrl },
            footer: footer.ar,
          }
        : {
            subject: `You're invited to join ${data.companyName}`,
            heading: `Hello ${data.fullName},`,
            paragraphs: [
              `${data.invitedByName} has invited you to join ${data.companyName} on the HSE Management Platform.`,
              'Select the button below to set your password and activate your account.',
              `This invitation expires on ${expiry} and works only once.`,
            ],
            action: { label: 'Activate account', url: secrets.acceptUrl },
            footer: footer.en,
          };
    },
  }),

  'user.invitation_accepted': define({
    data: z.object({ inviterName: z.string(), fullName: z.string(), usersUrl: z.url() }),
    secrets: null,
    content: (language, data) =>
      language === 'ar'
        ? {
            subject: `انضم ${data.fullName} إلى فريقك`,
            heading: `مرحبًا ${data.inviterName}،`,
            paragraphs: [`قبل ${data.fullName} دعوتك وفعّل حسابه.`],
            action: { label: 'عرض المستخدمين', url: data.usersUrl },
            footer: footer.ar,
          }
        : {
            subject: `${data.fullName} has joined your team`,
            heading: `Hello ${data.inviterName},`,
            paragraphs: [`${data.fullName} accepted your invitation and activated their account.`],
            action: { label: 'View users', url: data.usersUrl },
            footer: footer.en,
          },
  }),

  'auth.password_reset': define({
    data: z.object({ fullName: z.string(), minutes: z.number().int().positive() }),
    secrets: z.object({ resetUrl: z.url() }),
    content: (language, data, secrets) =>
      language === 'ar'
        ? {
            subject: 'إعادة تعيين كلمة المرور',
            heading: `مرحبًا ${data.fullName}،`,
            paragraphs: [
              'طلبت إعادة تعيين كلمة المرور. اضغط على الزر أدناه لاختيار كلمة مرور جديدة.',
              `يعمل هذا الرابط لمدة ${data.minutes} دقيقة ومرة واحدة فقط.`,
            ],
            action: { label: 'تعيين كلمة مرور جديدة', url: secrets.resetUrl },
            footer: 'إذا لم تطلب ذلك، تجاهل هذه الرسالة؛ لم تتغير كلمة المرور.',
          }
        : {
            subject: 'Reset your password',
            heading: `Hello ${data.fullName},`,
            paragraphs: [
              'You asked to reset your password. Select the button below to choose a new one.',
              `This link works for ${data.minutes} minutes and only once.`,
            ],
            action: { label: 'Set a new password', url: secrets.resetUrl },
            footer: "If you didn't ask for this, ignore this email — your password hasn't changed.",
          },
  }),

  'auth.password_changed': define({
    data: z.object({
      fullName: z.string(),
      changedAt: z.number(),
      timeZone: z.string(),
      forgotPasswordUrl: z.url(),
    }),
    secrets: null,
    content: (language, data) => {
      const when = formatDate(language, data.changedAt, data.timeZone);
      return language === 'ar'
        ? {
            subject: 'تم تغيير كلمة المرور',
            heading: `مرحبًا ${data.fullName}،`,
            paragraphs: [
              `تم تغيير كلمة مرور حسابك في ${when}.`,
              'إذا لم تقم بذلك، أعد تعيين كلمة المرور الآن وتواصل مع مسؤول شركتك.',
            ],
            action: { label: 'إعادة تعيين كلمة المرور', url: data.forgotPasswordUrl },
            footer: footer.ar,
          }
        : {
            subject: 'Your password was changed',
            heading: `Hello ${data.fullName},`,
            paragraphs: [
              `The password of your account was changed on ${when}.`,
              "If this wasn't you, reset it now and contact your administrator.",
            ],
            action: { label: 'Reset password', url: data.forgotPasswordUrl },
            footer: footer.en,
          };
    },
  }),
  ...SUBSCRIPTION_EMAIL_TEMPLATES,
} as const;

export type EmailTemplateName = keyof typeof EMAIL_TEMPLATES;
export type EmailTemplateData<T extends EmailTemplateName> = z.input<
  (typeof EMAIL_TEMPLATES)[T]['data']
>;
export type EmailTemplateSecrets<T extends EmailTemplateName> =
  (typeof EMAIL_TEMPLATES)[T]['secrets'] extends z.ZodType
    ? z.input<NonNullable<(typeof EMAIL_TEMPLATES)[T]['secrets']>>
    : undefined;

export function isEmailTemplateName(value: string): value is EmailTemplateName {
  return value in EMAIL_TEMPLATES;
}

export function templateHasSecrets(name: EmailTemplateName): boolean {
  return EMAIL_TEMPLATES[name].secrets !== null;
}

/** Validates data and secrets, then renders the template in the given language. */
export function renderEmail(
  name: EmailTemplateName,
  language: Language,
  data: unknown,
  secrets: unknown,
): RenderedEmail {
  const template = EMAIL_TEMPLATES[name] as unknown as TemplateDefinition<
    z.ZodType,
    z.ZodType | null
  >;
  const parsedData = template.data.parse(data);
  const parsedSecrets = template.secrets ? template.secrets.parse(secrets) : null;
  return renderLayout(language, template.content(language, parsedData, parsedSecrets));
}
