import { Sparkles } from 'lucide-react';

interface ClientExperienceHeaderProps {
  title: string;
  subtitle: string;
}

export default function ClientExperienceHeader({ title, subtitle }: ClientExperienceHeaderProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="rounded-xl bg-indigo-100 p-2 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
        <Sparkles className="h-5 w-5" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">{subtitle}</p>
      </div>
    </div>
  );
}
