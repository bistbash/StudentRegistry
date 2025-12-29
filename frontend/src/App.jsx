import { useState, useEffect } from 'react'
import { useAuth } from './AuthContext'
import { login, logout, getAccessToken, handleCallback, initAuth } from './auth'

// Get API URL - always use the same origin/hostname as the frontend
const getApiUrl = () => {
  // In browser, always use the same origin/hostname as the frontend
  if (typeof window !== 'undefined') {
    const origin = window.location.origin;
    // If accessing via localhost/127.0.0.1, use localhost:3001
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return 'http://localhost:3001';
    }
    // Otherwise use the same hostname with port 3001
    return origin.replace(/:3000$/, ':3001');
  }
  // Fallback to env var or default
  return import.meta.env.VITE_API_URL || 'http://localhost:3001';
};

const API_URL = getApiUrl()

function App() {
  const { user, loading: authLoading, authEnabled, setUser } = useAuth()
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [processingCallback, setProcessingCallback] = useState(false)

  const processCallback = async () => {
    setProcessingCallback(true)
    try {
      const userData = await handleCallback()
      if (userData) {
        setUser(userData)
        // Clean up URL
        window.history.replaceState({}, document.title, '/')
      }
    } catch (error) {
      console.error('Error processing callback:', error)
      setError('ההתחברות נכשלה. נסה שוב.')
    } finally {
      setProcessingCallback(false)
    }
  }

  useEffect(() => {
    initAuth()
    
    // Check if we're processing a callback (OAuth callback contains code parameter)
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.has('code')) {
      processCallback()
    }
  }, [])

  useEffect(() => {
    if (!authLoading && !processingCallback) {
      fetchStudents()
    }
  }, [user, authLoading, processingCallback])

  const fetchStudents = async () => {
    try {
      setLoading(true)
      const headers = {}
      
      // Add auth token if available
      if (authEnabled && user) {
        const token = await getAccessToken()
        console.log('Access token retrieved:', token ? 'Yes (length: ' + token.length + ')' : 'No');
        if (token) {
          headers['Authorization'] = `Bearer ${token}`
        } else {
          console.warn('Auth enabled and user exists but no access token found');
          setError('אסימון ההתחברות לא זמין. התחבר שוב.')
          return
        }
      } else if (authEnabled && !user) {
        setError('התחבר כדי לראות סטודנטים')
        return
      }

      console.log('Fetching students from:', `${API_URL}/api/students`);
      console.log('Request headers:', headers);
      const response = await fetch(`${API_URL}/api/students`, {
        headers,
      })

      console.log('Response status:', response.status);
      if (response.status === 401) {
        // Not authenticated
        if (authEnabled) {
          setError('התחבר כדי לראות את רשימת הלומדים')
          // Clear user state if token is invalid
          setUser(null)
        } else {
          throw new Error('נכשל בטעינת רשימת הלומדים')
        }
        return
      }

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Failed to fetch students:', response.status, errorText)
        throw new Error(`נכשל בטעינת רשימת הלומדים: ${response.status}`)
      }

      const data = await response.json()
      console.log('Received students data:', data)
      console.log('Number of students:', data.length)
      setStudents(data)
      setError(null)
    } catch (err) {
      setError(err.message)
      console.error('Error fetching students:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleLogin = async () => {
    try {
      await login()
    } catch (error) {
      console.error('Login error:', error)
      setError('ההתחברות נכשלה. נסה שוב.')
    }
  }

  const handleLogout = async () => {
    try {
      await logout()
      setUser(null)
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  if (processingCallback || authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">טוען...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation Bar */}
      <nav className="bg-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <h1 className="text-2xl font-bold text-gray-900">רשימת לומדים</h1>
            {authEnabled && (
              <div className="flex items-center gap-4">
                {user ? (
                  <>
                    <span className="text-sm text-gray-600">
                      {user.profile?.name || user.profile?.email || 'משתמש'}
                    </span>
                    <button
                      onClick={handleLogout}
                      className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
                    >
                      התנתקות
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleLogin}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                  >
                    התחברות
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white shadow rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">מרשם לומדים</h2>
            <p className="mt-1 text-sm text-gray-500">רשימת לומדים רשומים</p>
          </div>

          {loading && (
            <div className="px-6 py-8 text-center">
              <p className="text-gray-500">טוען רשימת לומדים...</p>
            </div>
          )}

          {error && (
            <div className="px-6 py-4 bg-red-50 border-r-4 border-red-400">
              <p className="text-red-700">שגיאה: {error}</p>
            </div>
          )}

          {!loading && !error && (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 tracking-wider">
                      ת.ז
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 tracking-wider">
                      שם משפחה
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 tracking-wider">
                      שם פרטי
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 tracking-wider">
                      כיתה
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 tracking-wider">
                      מקבילה
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 tracking-wider">
                      מין
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 tracking-wider">
                      מגמה
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 tracking-wider">
                      סטטוס
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 tracking-wider">
                      מחזור
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {students.length === 0 ? (
                    <tr>
                      <td colSpan="9" className="px-6 py-4 text-center text-gray-500">
                        לא נמצאו לומדים
                      </td>
                    </tr>
                  ) : (
                    students.map((student) => (
                      <tr key={student.id} className="hover:bg-gray-50">
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                          {student.idNumber}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {student.lastName}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {student.firstName}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700">
                          {student.grade}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 text-center">
                          {student.stream}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700">
                          {student.gender}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700">
                          {student.track}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            student.status === 'לומד' 
                              ? 'bg-green-100 text-green-800' 
                              : student.status === 'סיים לימודים'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}>
                            {student.status}
                          </span>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700">
                          {student.cycle}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App

