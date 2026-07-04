import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import ru from './ru.json';

export const LANGUAGES = [
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

function initialLanguage(): LanguageCode {
  try {
    const stored = localStorage.getItem('lang');
    if (stored === 'ru' || stored === 'en') return stored;
  } catch {
    /* localStorage unavailable — fall through to default */
  }
  return 'ru';
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ru: { translation: ru },
  },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes values
});

/** Change the UI language and remember the choice for next time. */
export function setLanguage(lng: LanguageCode): void {
  void i18n.changeLanguage(lng);
  try {
    localStorage.setItem('lang', lng);
  } catch {
    /* ignore persistence failures (e.g. private mode) */
  }
}

export default i18n;
