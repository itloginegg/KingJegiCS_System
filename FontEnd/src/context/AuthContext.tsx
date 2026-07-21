import {
  createContext,
  useCallback,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import type {
  AuthCredentials,
  AuthState,
  LoginResult,
  OtpVerification,
  User,
} from '../types/auth';
import {
  login as apiLogin,
  logout as apiLogout,
  verifyLoginOtp as apiVerifyLoginOtp,
  AuthError,
} from '../api/authApi';
import {
  clearSession,
  persistSession,
  readSession,
} from '../lib/tokenStorage';

interface AuthContextValue extends AuthState {
  login: (credentials: AuthCredentials) => Promise<LoginResult>;
  /** Login step 2: confirms the emailed code and opens the session. */
  verifyLoginOtp: (input: OtpVerification) => Promise<User>;
  logout: () => Promise<void>;
  /** Drops a lingering auth error (e.g. when leaving the OTP step). */
  clearError: () => void;
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
  | { type: 'AUTH_RESET' }
  | { type: 'LOGOUT' };

const initialState: AuthState = {
  status: 'idle',
  user: null,
  token: null,
  error: null,
};

/**
 * Rehydrate synchronously so guarded routes see the restored session on the
 * very first render. Doing this in a useEffect instead makes a refresh of
 * /dashboard flash through /login before bouncing back.
 */
function initAuthState(): AuthState {
  if (typeof window === 'undefined') return initialState;
  const session = readSession();
  return session
    ? { status: 'authenticated', user: session.user, token: session.token, error: null }
    : initialState;
}

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
    case 'AUTH_RESET':
      // Back to a clean pre-auth state without touching an open session.
      return state.status === 'authenticated'
        ? state
        : { ...state, status: 'idle', error: null };
    case 'LOGOUT':
      return { ...initialState };
    default:
      return state;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initAuthState);

  const login = useCallback(
    async (credentials: AuthCredentials): Promise<LoginResult> => {
      dispatch({ type: 'AUTH_START' });
      try {
        const res = await apiLogin(credentials);
        if (res.otpRequired) {
          // Password accepted, but no session yet — the caller must collect
          // the emailed code and finish via verifyLoginOtp.
          dispatch({ type: 'AUTH_RESET' });
          return res;
        }
        persistSession({
          token: res.token,
          user: res.user,
          rememberMe: credentials.rememberMe,
        });
        dispatch({ type: 'AUTH_SUCCESS', user: res.user, token: res.token });
        return res;
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

  const verifyLoginOtp = useCallback(
    async ({ role, email, code, rememberMe }: OtpVerification): Promise<User> => {
      dispatch({ type: 'AUTH_START' });
      try {
        const res = await apiVerifyLoginOtp(role, email, code);
        persistSession({ token: res.token, user: res.user, rememberMe });
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

  const clearError = useCallback(() => dispatch({ type: 'AUTH_RESET' }), []);

  const logout = useCallback(async (): Promise<void> => {
    await apiLogout(state.token, state.user?.role);
    clearSession();
    dispatch({ type: 'LOGOUT' });
  }, [state.token, state.user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login,
      verifyLoginOtp,
      logout,
      clearError,
      isAuthenticated: state.status === 'authenticated' && state.user !== null,
    }),
    [state, login, verifyLoginOtp, logout, clearError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
