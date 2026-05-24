import { useState } from 'react';
import { Link } from 'react-router-dom';
import { User } from '../../App';
import companyLogoLight from '../../assets/logo-colin.png';
import companyLogoDark from '../../assets/logo-colin-dark-mode.png';
import { loginApi } from '../../services/authService';
import { useTheme } from '../../hooks/useTheme';

interface LoginProps {
  onLogin: (user: User) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { isDark } = useTheme();
  const companyLogo = isDark ? companyLogoDark : companyLogoLight;

  const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setError('');
  setLoading(true);

  try {
    const response = await loginApi(email, password);

    localStorage.setItem('token', response.token);
    localStorage.setItem('user', JSON.stringify(response.user));

    onLogin(response.user);
  } catch (err: any) {
    setError(err.message || 'Login failed');
  } finally {
    setLoading(false);
  }
};

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-300 dark:border-gray-700 p-8 shadow-sm">
          <div className="text-center mb-10">
            <img
              src={companyLogo}
              alt="Colin & Colin Logo"
              className="mx-auto h-16 object-contain mb-4"
            />
            <p className="text-gray-700 dark:text-gray-300 font-medium text-base mt-2">
              Sign in to your account
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500"
                placeholder="your@email.com"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500"
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-gray-800 dark:bg-gray-700 text-white py-2 px-4 rounded hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors"
              disabled={loading}
            >
              {loading ? 'Signing In...' : 'Sign In'}
            </button>
          </form>

          
        </div>
      </div>
    </div>
  );
}
