import { ArrowDown } from 'lucide-react';

export default function MatterLifecycle() {
  return (
    <div className="mb-8 bg-white dark:bg-gray-800 rounded-lg shadow p-8">
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">Matter Lifecycle</h2>
      
      <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-6">
        {/* Intake & Prospects */}
        <div className="flex flex-col items-center">
          <div className="w-40 h-32 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-900/40 border-2 border-blue-300 dark:border-blue-600 rounded-lg flex flex-col items-center justify-center p-4 text-center">
            <div className="text-lg font-bold text-blue-900 dark:text-blue-300">Intake & Prospects</div>
            <div className="text-xs text-blue-700 dark:text-blue-200 mt-2">Initial contact & qualification</div>
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-400 mt-2">Inquiry → Engagement</div>
        </div>

        {/* Arrow Down */}
        <div className="hidden md:flex md:flex-col items-center">
          <ArrowDown className="w-6 h-6 text-gray-400 dark:text-gray-600 animate-bounce" />
        </div>

        {/* Client Onboarding */}
        <div className="flex flex-col items-center">
          <div className="w-40 h-32 bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-900/40 border-2 border-purple-300 dark:border-purple-600 rounded-lg flex flex-col items-center justify-center p-4 text-center">
            <div className="text-lg font-bold text-purple-900 dark:text-purple-300">Client Onboarding</div>
            <div className="text-xs text-purple-700 dark:text-purple-200 mt-2">Sign agreements & setup</div>
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-400 mt-2">Engagement letter signed</div>
        </div>

        {/* Arrow Down */}
        <div className="hidden md:flex md:flex-col items-center">
          <ArrowDown className="w-6 h-6 text-gray-400 dark:text-gray-600 animate-bounce" />
        </div>

        {/* Active Matters */}
        <div className="flex flex-col items-center">
          <div className="w-40 h-32 bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-900/40 border-2 border-green-300 dark:border-green-600 rounded-lg flex flex-col items-center justify-center p-4 text-center">
            <div className="text-lg font-bold text-green-900 dark:text-green-300">Active Matters</div>
            <div className="text-xs text-green-700 dark:text-green-200 mt-2">Work in progress</div>
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-400 mt-2">Full case management</div>
        </div>
      </div>

      <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded">
        <p className="text-sm text-blue-900 dark:text-blue-200">
          <strong>Auto-Conversion:</strong> When a prospect moves to "Engagement" stage and is formally onboarded, it automatically converts to an Active Matter. Track all communication, conflict checks, and quotes in Intake before committing to a full engagement.
        </p>
      </div>
    </div>
  );
}
