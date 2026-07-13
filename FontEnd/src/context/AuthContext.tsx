import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import type { AuthCredentials, AuthState, User } from '../types/auth';
import { login as apiLogin, logout as apiLogout, AuthError } from '../api/authApi';
import {
  clearSession,
  persistSession,
  readSession,
} from '../lib/tokenStorage';

interface AuthContextValue extends AuthState {
  login: (credentials: AuthCredentials) => Promise<User>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
}

// Exported so the hook in useAuth.ts can consume it. Default is `null` so we
// can throw a clear error if the hook is used outside the provider.
export const AuthContext = createContext<AuthContextValue | null>(null);

type Action =
  | { type: 'RESTORE'; user: User; token: string }
  | { type: 'AUTH_START' }
  | { type: 'AUTH_SUCCESS'; user: User; token: string }
  | { type: 'AUTH_ERROR'; error: string }
  | { type: 'LOGOUT' };

const initialState: AuthState = {
  status: 'idle',
  user: null,
  token: null,
  error: null,
};

function reducer(state: AuthState, action: Action): AuthState {
  switch (action.type) {
    case 'RESTORE':
    case 'AUTH_SUCCESS':
      return {
        status: 'authenticated',
        user: action.user,
        token: action.token,
        error: null,
      };
    case 'AUTH_START':
      return { ...state, status: 'authenticating', error: null };
    case 'AUTH_ERROR':
      return { ...state, status: 'error', error: action.error };
    case 'LOGOUT':
      return { ...initialState };
    default:
      return state;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Rehydrate from storage on first mount so refreshes keep the user signed in.
  useEffect(() => {
    const session = readSession();
    if (session) {
      dispatch({ type: 'RESTORE', user: session.user, token: session.token });
    }
  }, []);

  const login = useCallback(
    async (credentials: AuthCredentials): Promise<User> => {
      dispatch({ type: 'AUTH_START' });
      try {
        const res = await apiLogin(credentials);
        persistSession({
          token: res.token,
          user: res.user,
          rememberMe: credentials.rememberMe,
        });
        dispatch({ type: 'AUTH_SUCCESS', user: res.user, token: res.token });
        return res.user;
      } catch (err) {
        const message =
          err instanceof AuthError
            ? err.message
            : 'Something went wrong. Please try again.';
        dispatch({ type: 'AUTH_ERROR', error: message });
        throw err;
      }
    },
    [],
  );

  const logout = useCallback(async (): Promise<void> => {
    await apiLogout(state.token, state.user?.role);
    clearSession();
    dispatch({ type: 'LOGOUT' });
  }, [state.token, state.user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login,
      logout,
      isAuthenticated: state.status === 'authenticated' && state.user !== null,
    }),
    [state, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
