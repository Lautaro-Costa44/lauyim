import { createContext, useContext } from 'react'

// Data and loaders owned by AdminLayout (including the 15 s users poll), shared by every
// admin section. Replaces the router outlet context now that the sections are routed inside
// AdminLayout itself.
export const AdminContext = createContext(null)
export const useAdmin = () => useContext(AdminContext)
