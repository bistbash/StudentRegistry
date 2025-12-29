import { createContext, useContext, useState, useEffect } from 'react';
import { getUser, isAuthenticated, getAuthConfig } from './auth';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authEnabled, setAuthEnabled] = useState(false);

  useEffect(() => {
    let mounted = true;
    
    const checkAuth = async () => {
      try {
        // Set a maximum timeout for the entire auth check
        const configPromise = getAuthConfig();
        const overallTimeout = new Promise((resolve) => 
          setTimeout(() => {
            if (mounted) {
              console.warn('Auth check taking too long, proceeding without auth');
              resolve({ enabled: false });
            }
          }, 5000)
        );
        
        const config = await Promise.race([configPromise, overallTimeout]);
        
        if (!mounted) return;
        
        setAuthEnabled(config.enabled || false);

        if (config.enabled) {
          // Quick check for existing user (non-blocking)
          try {
            const authCheckPromise = isAuthenticated();
            const timeoutPromise = new Promise((resolve) => 
              setTimeout(() => resolve(false), 2000)
            );
            
            const authenticated = await Promise.race([authCheckPromise, timeoutPromise]);
            
            if (authenticated && mounted) {
              const userData = await getUser();
              console.log('User data retrieved:', userData ? 'Yes' : 'No', userData ? '(has access_token: ' + !!userData.access_token + ')' : '');
              if (mounted && userData) {
                setUser(userData);
              }
            }
          } catch (error) {
            console.error('Error checking authentication:', error);
            // Continue without user
          }
        }
      } catch (error) {
        console.error('Error in auth check:', error);
        if (mounted) {
          setAuthEnabled(false);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    checkAuth();
    
    return () => {
      mounted = false;
    };
  }, []);

  const value = {
    user,
    loading,
    authEnabled,
    setUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

