import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth'
import { Home, RequireAuth } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { ObjectsPage } from './pages/ObjectsPage'
import { ObjectPage, NotFound } from './pages/ObjectPage'
import { TaskPage } from './pages/TaskPage'
import { MyTasksPage } from './pages/MyTasksPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route index element={<Home />} />
            <Route path="/objects" element={<ObjectsPage />} />
            <Route path="/objects/:id" element={<ObjectPage />} />
            <Route path="/tasks/:id" element={<TaskPage />} />
            <Route path="/my" element={<MyTasksPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
