import i18n from '../i18n';

export function Loading({ label }: { label?: string }) {
  return <p className="py-8 text-center text-sm text-slate-400">{label ?? i18n.t('common.loading')}</p>;
}

export function ErrorNote({ message }: { message: string }) {
  return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{message}</p>;
}

export function Empty({ label }: { label: string }) {
  return <p className="py-8 text-center text-sm text-slate-400">{label}</p>;
}
